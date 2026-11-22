import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { PasswordHasherService } from './password-hasher.service';
import { UserPrincipal } from './api-key.types';
import { DataEncryptionService } from '../customers/data-encryption.service';
import { TotpService } from './totp.service';

interface MembershipRow {
  user_id: string;
  email: string;
  password_hash: string | null;
  user_status: string;
  email_verified_at: Date | null;
  institution_id: string;
  institution_status: string;
  membership_status: string;
  role: UserPrincipal['role'];
}

interface RefreshMembershipRow extends Omit<MembershipRow, 'password_hash'> {
  token_id: string;
  session_id: string;
  token_expires_at: Date;
  token_consumed_at: Date | null;
  token_revoked_at: Date | null;
  session_revoked_at: Date | null;
  session_expires_at: Date;
}

@Injectable()
export class AuthService {
  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlDays: number;

  constructor(
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
    private readonly passwordHasher: PasswordHasherService,
    private readonly encryption: DataEncryptionService,
    private readonly totp: TotpService,
    config: ConfigService,
  ) {
    this.accessTokenTtlSeconds = config.get<number>('AUTH_ACCESS_TOKEN_TTL_SECONDS', 900);
    this.refreshTokenTtlDays = config.get<number>('AUTH_REFRESH_TOKEN_TTL_DAYS', 30);
  }

  async acceptInvitation(invitationToken: string, password: string): Promise<{ status: 'accepted'; email: string; institutionId: string }> {
    const passwordHash = await this.passwordHasher.hash(password);
    const tokenHash = this.hashToken(invitationToken);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inviteResult = await client.query<{
        id: string;
        institution_id: string;
        email: string;
        email_normalized: string;
        role: UserPrincipal['role'];
      }>(
        `SELECT id, institution_id, email, email_normalized, role
         FROM institution_invitations
         WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL
           AND expires_at > now()
         FOR UPDATE`,
        [tokenHash],
      );
      const invite = inviteResult.rows[0];
      if (!invite) throw new UnauthorizedException('Invitation is invalid or expired');

      const userResult = await client.query<{
        id: string;
        status: string;
        password_hash: string | null;
        email_verified_at: Date | null;
      }>(
        `SELECT id, status, password_hash, email_verified_at
         FROM users WHERE email_normalized = $1 FOR UPDATE`,
        [invite.email_normalized],
      );
      let userId: string;
      const user = userResult.rows[0];
      if (!user) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, status, email_verified_at)
           VALUES ($1, $2, 'ACTIVE', now()) RETURNING id`,
          [invite.email, passwordHash],
        );
        userId = created.rows[0].id;
      } else if (user.status === 'INVITED' && !user.password_hash) {
        await client.query(
          `UPDATE users SET password_hash = $2, status = 'ACTIVE',
             email_verified_at = now(), updated_at = now()
           WHERE id = $1`,
          [user.id, passwordHash],
        );
        userId = user.id;
      } else if (
        user.status === 'ACTIVE' && user.email_verified_at && user.password_hash &&
        await this.passwordHasher.verify(password, user.password_hash)
      ) {
        userId = user.id;
      } else {
        throw new UnauthorizedException('Invitation cannot be accepted with these credentials');
      }

      await client.query(
        `INSERT INTO institution_memberships (institution_id, user_id, role, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         ON CONFLICT (institution_id, user_id)
         DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE'`,
        [invite.institution_id, userId, invite.role],
      );
      await client.query(
        `UPDATE institution_invitations SET accepted_at = now() WHERE id = $1`,
        [invite.id],
      );
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id)
         VALUES ($1, $2, 'institution.invitation.accepted', 'user', $3)`,
        [invite.institution_id, userId, userId],
      );
      await client.query('COMMIT');
      return { status: 'accepted', email: invite.email, institutionId: invite.institution_id };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async login(email: string, password: string, institutionId: string, totpCode?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.pool.query<MembershipRow>(
      `SELECT u.id AS user_id, u.email, u.password_hash, u.status AS user_status,
              u.email_verified_at, i.id AS institution_id, i.status AS institution_status,
              m.status AS membership_status, m.role
       FROM users u
       JOIN institution_memberships m ON m.user_id = u.id
       JOIN institutions i ON i.id = m.institution_id
       WHERE u.email_normalized = $1 AND i.id = $2`,
      [normalizedEmail, institutionId],
    );
    const membership = result.rows[0];
    const passwordMatches = membership?.password_hash
      ? await this.passwordHasher.verify(password, membership.password_hash)
      : await this.passwordHasher.hash(password).then(() => false);

    if (
      !membership || !passwordMatches || membership.user_status !== 'ACTIVE' ||
      !membership.email_verified_at || membership.membership_status !== 'ACTIVE' ||
      !['ACTIVE', 'PENDING_REVIEW'].includes(membership.institution_status)
    ) {
      throw new UnauthorizedException('Email, password, or institution is invalid');
    }

    const mfa = await this.pool.query<{
      secret_key_id: string; secret_ciphertext: string; secret_iv: string; secret_auth_tag: string;
      enabled_at: Date | null; last_totp_step: string;
    }>(
      `SELECT secret_key_id, secret_ciphertext, secret_iv, secret_auth_tag, enabled_at, last_totp_step::text
       FROM user_mfa WHERE user_id = $1`, [membership.user_id],
    );
    const configured = mfa.rows[0];
    if (!configured?.enabled_at) {
      if (membership.role === 'OWNER' || membership.role === 'ADMIN') {
        return { mfaSetupRequired: true as const, challengeToken: await this.issueMfaChallenge(membership.user_id, membership.institution_id, 'mfa_setup') };
      }
      return this.createSession(membership);
    }
    if (!totpCode) {
      return { mfaRequired: true as const, challengeToken: await this.issueMfaChallenge(membership.user_id, membership.institution_id, 'mfa_login') };
    }
    const secret = this.encryption.decrypt({ keyId: configured.secret_key_id, ciphertext: configured.secret_ciphertext, iv: configured.secret_iv, authTag: configured.secret_auth_tag });
    const acceptedStep = this.totp.verify(secret, totpCode);
    if (acceptedStep === null || acceptedStep <= Number(configured.last_totp_step) || !(await this.consumeTotpStep(membership.user_id, acceptedStep))) {
      throw new UnauthorizedException('Email, password, or MFA code is invalid');
    }
    return this.createSession(membership);
  }

  async startMfaSetup(challengeToken: string) {
    const membership = await this.verifyMfaChallenge(challengeToken, 'mfa_setup');
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') throw new ForbiddenException('MFA setup challenge is not valid for this role');
    return this.createMfaSetup(membership.user_id);
  }

  async confirmMfaSetup(challengeToken: string, code: string) {
    const membership = await this.verifyMfaChallenge(challengeToken, 'mfa_setup');
    if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') throw new ForbiddenException('MFA setup challenge is not valid for this role');
    return this.enableMfa(membership.user_id, membership.institution_id, code);
  }

  async finishMfaLogin(challengeToken: string, code?: string, recoveryCode?: string) {
    const membership = await this.verifyMfaChallenge(challengeToken, 'mfa_login');
    const result = await this.pool.query<{
      secret_key_id: string; secret_ciphertext: string; secret_iv: string; secret_auth_tag: string;
      last_totp_step: string;
    }>(`SELECT secret_key_id, secret_ciphertext, secret_iv, secret_auth_tag, last_totp_step::text
        FROM user_mfa WHERE user_id = $1 AND enabled_at IS NOT NULL`, [membership.user_id]);
    const mfa = result.rows[0];
    if (!mfa) throw new UnauthorizedException('MFA is not enabled for this account');
    let accepted = false;
    if (code) {
      const secret = this.encryption.decrypt({ keyId: mfa.secret_key_id, ciphertext: mfa.secret_ciphertext, iv: mfa.secret_iv, authTag: mfa.secret_auth_tag });
      const step = this.totp.verify(secret, code);
      if (step !== null && step > Number(mfa.last_totp_step)) accepted = await this.consumeTotpStep(membership.user_id, step);
    } else if (recoveryCode) {
      const consumed = await this.pool.query(
        `UPDATE user_mfa_recovery_codes SET consumed_at = now()
         WHERE user_id = $1 AND code_hash = $2 AND consumed_at IS NULL RETURNING id`,
        [membership.user_id, this.totp.hashRecoveryCode(recoveryCode)],
      );
      accepted = consumed.rowCount === 1;
    }
    if (!accepted) throw new UnauthorizedException('MFA code is invalid or has already been used');
    await this.auditMfa(membership.institution_id, membership.user_id, 'auth.mfa.login_verified');
    return this.createSession(membership);
  }

  async startOptionalMfaEnrollment(principal: UserPrincipal) {
    const enabled = await this.pool.query(`SELECT 1 FROM user_mfa WHERE user_id = $1 AND enabled_at IS NOT NULL`, [principal.userId]);
    if (enabled.rowCount) throw new ConflictException('MFA is already enabled');
    return this.createMfaSetup(principal.userId);
  }

  async confirmOptionalMfaEnrollment(principal: UserPrincipal, code: string) {
    return this.enableMfa(principal.userId, principal.institutionId, code);
  }

  private async createMfaSetup(userId: string) {
    const secret = this.totp.generateSecret();
    const encrypted = this.encryption.encrypt(secret);
    const stored = await this.pool.query(
      `INSERT INTO user_mfa (user_id, secret_key_id, secret_ciphertext, secret_iv, secret_auth_tag, enabled_at, last_totp_step)
       VALUES ($1, $2, $3, $4, $5, NULL, -1)
       ON CONFLICT (user_id) DO UPDATE SET secret_key_id = EXCLUDED.secret_key_id,
         secret_ciphertext = EXCLUDED.secret_ciphertext, secret_iv = EXCLUDED.secret_iv,
         secret_auth_tag = EXCLUDED.secret_auth_tag, updated_at = now()
       WHERE user_mfa.enabled_at IS NULL`,
      [userId, encrypted.keyId, encrypted.ciphertext, encrypted.iv, encrypted.authTag],
    );
    if (stored.rowCount !== 1) throw new ConflictException('MFA is already enabled');
    return { secret, otpauthUrl: `otpauth://totp/TREAD:${encodeURIComponent(userId)}?secret=${secret}&issuer=TREAD&algorithm=SHA1&digits=6&period=30` };
  }

  private async enableMfa(userId: string, institutionId: string, code: string) {
    const client = await this.pool.connect();
    const recoveryCodes = this.totp.recoveryCodes();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        secret_key_id: string; secret_ciphertext: string; secret_iv: string; secret_auth_tag: string;
      }>(`SELECT secret_key_id, secret_ciphertext, secret_iv, secret_auth_tag FROM user_mfa
          WHERE user_id = $1 AND enabled_at IS NULL FOR UPDATE`, [userId]);
      const row = result.rows[0];
      if (!row) throw new ConflictException('MFA setup has not been started or is already complete');
      const secret = this.encryption.decrypt({ keyId: row.secret_key_id, ciphertext: row.secret_ciphertext, iv: row.secret_iv, authTag: row.secret_auth_tag });
      const step = this.totp.verify(secret, code);
      if (step === null) throw new UnauthorizedException('MFA code is invalid');
      const enabled = await client.query(
        `UPDATE user_mfa SET enabled_at = now(), last_totp_step = $2, updated_at = now()
         WHERE user_id = $1 AND enabled_at IS NULL`, [userId, step],
      );
      if (enabled.rowCount !== 1) throw new ConflictException('MFA setup was already completed');
      for (const recoveryCode of recoveryCodes) {
        await client.query(`INSERT INTO user_mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`,
          [userId, this.totp.hashRecoveryCode(recoveryCode)]);
      }
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id)
         VALUES ($1, $2, 'auth.mfa.enabled', 'user_mfa', $3)`, [institutionId, userId, userId],
      );
      await client.query('COMMIT');
      return { status: 'enabled' as const, recoveryCodes };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally { client.release(); }
  }

  private async issueMfaChallenge(userId: string, institutionId: string, purpose: 'mfa_setup' | 'mfa_login') {
    return this.jwt.signAsync({ sid: randomBytes(16).toString('hex'), iid: institutionId, purpose }, {
      subject: userId, issuer: 'tread-api', audience: 'tread-mfa', expiresIn: 300,
    });
  }

  private async verifyMfaChallenge(token: string, purpose: 'mfa_setup' | 'mfa_login') {
    let claims: { sub?: string; iid?: string; purpose?: string };
    try { claims = await this.jwt.verifyAsync(token, { issuer: 'tread-api', audience: 'tread-mfa' }); }
    catch { throw new UnauthorizedException('MFA challenge is invalid or expired'); }
    if (!claims.sub || !claims.iid || claims.purpose !== purpose) throw new UnauthorizedException('MFA challenge is invalid or expired');
    const result = await this.pool.query<MembershipRow>(
      `SELECT u.id AS user_id, u.email, u.password_hash, u.status AS user_status, u.email_verified_at,
         i.id AS institution_id, i.status AS institution_status, m.status AS membership_status, m.role
       FROM users u JOIN institution_memberships m ON m.user_id = u.id
       JOIN institutions i ON i.id = m.institution_id
       WHERE u.id = $1 AND i.id = $2 AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
         AND m.status = 'ACTIVE' AND i.status IN ('ACTIVE', 'PENDING_REVIEW')`, [claims.sub, claims.iid]);
    const membership = result.rows[0];
    if (!membership) throw new UnauthorizedException('MFA challenge is invalid or expired');
    return membership;
  }

  private async consumeTotpStep(userId: string, step: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE user_mfa SET last_totp_step = $2, updated_at = now()
       WHERE user_id = $1 AND enabled_at IS NOT NULL AND last_totp_step < $2`, [userId, step]);
    return result.rowCount === 1;
  }

  private async auditMfa(institutionId: string, userId: string, action: string) {
    await this.pool.query(
      `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id)
       VALUES ($1, $2, $3, 'user_mfa', $4)`, [institutionId, userId, action, userId]);
  }

  async refresh(refreshToken: string) {
    const tokenHash = this.hashToken(refreshToken);
    const newRefreshToken = randomBytes(32).toString('base64url');
    const newRefreshHash = this.hashToken(newRefreshToken);
    const client = await this.pool.connect();
    let membership: RefreshMembershipRow | undefined;
    const nextExpiry = this.refreshExpiry();

    try {
      await client.query('BEGIN');
      const result = await client.query<RefreshMembershipRow>(
        `SELECT rt.id AS token_id, rt.session_id, rt.expires_at AS token_expires_at,
                rt.consumed_at AS token_consumed_at, rt.revoked_at AS token_revoked_at,
                s.revoked_at AS session_revoked_at, s.expires_at AS session_expires_at,
                u.id AS user_id, u.email, u.status AS user_status,
                u.email_verified_at, i.id AS institution_id, i.status AS institution_status,
                m.status AS membership_status, m.role
         FROM user_refresh_tokens rt
         JOIN user_sessions s ON s.id = rt.session_id
         JOIN users u ON u.id = rt.user_id
         JOIN institution_memberships m
           ON m.user_id = rt.user_id AND m.institution_id = rt.institution_id
         JOIN institutions i ON i.id = rt.institution_id
         WHERE rt.token_hash = $1
         FOR UPDATE OF rt, s`,
        [tokenHash],
      );
      membership = result.rows[0];
      if (!membership) throw new UnauthorizedException('Refresh token is invalid or expired');

      if (membership.token_consumed_at) {
        await client.query(
          `UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1`,
          [membership.session_id],
        );
        await client.query(
          `UPDATE user_refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
           WHERE session_id = $1`,
          [membership.session_id],
        );
        await client.query(
          `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id)
           VALUES ($1, $2, 'auth.refresh.reuse_detected', 'session', $3)`,
          [membership.institution_id, membership.user_id, membership.session_id],
        );
        await client.query('COMMIT');
        throw new UnauthorizedException('Refresh token reuse detected; session was revoked');
      }

      if (
        membership.token_revoked_at || membership.session_revoked_at ||
        membership.token_expires_at <= new Date() || membership.session_expires_at <= new Date() ||
        membership.user_status !== 'ACTIVE' || !membership.email_verified_at ||
        membership.membership_status !== 'ACTIVE' ||
        !['ACTIVE', 'PENDING_REVIEW'].includes(membership.institution_status)
      ) {
        throw new UnauthorizedException('Refresh token is invalid or expired');
      }

      await client.query(
        `UPDATE user_refresh_tokens SET consumed_at = now() WHERE id = $1`,
        [membership.token_id],
      );
      await client.query(
        `INSERT INTO user_refresh_tokens (session_id, user_id, institution_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [membership.session_id, membership.user_id, membership.institution_id, newRefreshHash, nextExpiry],
      );
      await client.query(
        `UPDATE user_sessions SET last_used_at = now(), expires_at = $2 WHERE id = $1`,
        [membership.session_id, nextExpiry],
      );
      await client.query('COMMIT');
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }

    return {
      accessToken: await this.createAccessToken(membership!.user_id, membership!.session_id, membership!.institution_id),
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenTtlSeconds,
      refreshExpiresAt: nextExpiry.toISOString(),
    };
  }

  async logout(principal: UserPrincipal): Promise<{ status: 'logged_out' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = $1 AND user_id = $2`,
        [principal.sessionId, principal.userId],
      );
      await client.query(
        `UPDATE user_refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
         WHERE session_id = $1`,
        [principal.sessionId],
      );
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id)
         VALUES ($1, $2, 'auth.logout', 'session', $3)`,
        [principal.institutionId, principal.userId, principal.sessionId],
      );
      await client.query('COMMIT');
      return { status: 'logged_out' };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async currentUser(principal: UserPrincipal) {
    return {
      id: principal.userId,
      email: principal.email,
      role: principal.role,
      institution: {
        id: principal.institutionId,
        status: principal.institutionStatus,
      },
    };
  }

  private async createSession(membership: MembershipRow) {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiry = this.refreshExpiry();
    const client = await this.pool.connect();
    let sessionId: string;
    try {
      await client.query('BEGIN');
      const session = await client.query<{ id: string }>(
        `INSERT INTO user_sessions (user_id, institution_id, expires_at)
         VALUES ($1, $2, $3) RETURNING id`,
        [membership.user_id, membership.institution_id, refreshExpiry],
      );
      sessionId = session.rows[0].id;
      await client.query(
        `INSERT INTO user_refresh_tokens (session_id, user_id, institution_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, membership.user_id, membership.institution_id, this.hashToken(refreshToken), refreshExpiry],
      );
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id)
         VALUES ($1, $2, 'auth.login.succeeded', 'session', $3)`,
        [membership.institution_id, membership.user_id, sessionId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }

    return {
      accessToken: await this.createAccessToken(membership.user_id, sessionId!, membership.institution_id),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenTtlSeconds,
      refreshExpiresAt: refreshExpiry.toISOString(),
      user: {
        id: membership.user_id,
        email: membership.email,
        role: membership.role,
        institution: { id: membership.institution_id, status: membership.institution_status },
      },
    };
  }

  private async createAccessToken(userId: string, sessionId: string, institutionId: string): Promise<string> {
    return this.jwt.signAsync(
      { sid: sessionId, iid: institutionId },
      {
        subject: userId,
        issuer: 'tread-api',
        audience: 'tread-clients',
        expiresIn: this.accessTokenTtlSeconds,
      },
    );
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async rollback(client: import('pg').PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error if the connection is already closed.
    }
  }
}
