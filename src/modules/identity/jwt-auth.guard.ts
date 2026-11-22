import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { Pool } from 'pg';
import { Inject } from '@nestjs/common';
import { POSTGRES_POOL } from '../../database/database.module';
import { UserPrincipal } from './api-key.types';
import { ForbiddenException } from '@nestjs/common';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(POSTGRES_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { userPrincipal?: UserPrincipal }>();
    const match = request.headers.authorization?.match(/^Bearer (\S+)$/i);
    if (!match) throw new UnauthorizedException('A valid access token is required');

    let claims: { sub: string; sid: string; iid: string };
    try {
      claims = await this.jwt.verifyAsync<{ sub: string; sid: string; iid: string }>(match[1], {
        issuer: 'tread-api',
        audience: 'tread-clients',
      });
    } catch {
      throw new UnauthorizedException('A valid access token is required');
    }

    if (!claims.sub || !claims.sid || !claims.iid) {
      throw new UnauthorizedException('A valid access token is required');
    }
    const result = await this.pool.query<{
      user_id: string;
      session_id: string;
      institution_id: string;
      role: UserPrincipal['role'];
      email: string;
      institution_status: UserPrincipal['institutionStatus'];
      mfa_enabled: boolean;
    }>(
      `SELECT u.id AS user_id, s.id AS session_id, i.id AS institution_id,
              m.role, u.email, i.status AS institution_status,
              (um.enabled_at IS NOT NULL) AS mfa_enabled
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN institution_memberships m
         ON m.user_id = s.user_id AND m.institution_id = s.institution_id
       JOIN institutions i ON i.id = s.institution_id
       LEFT JOIN user_mfa um ON um.user_id = u.id
       WHERE s.id = $1 AND s.user_id = $2 AND s.institution_id = $3
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.status = 'ACTIVE' AND u.email_verified_at IS NOT NULL
         AND m.status = 'ACTIVE'
         AND i.status IN ('PENDING_REVIEW', 'ACTIVE')`,
      [claims.sid, claims.sub, claims.iid],
    );
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException('Access token is no longer active');
    if ((row.role === 'OWNER' || row.role === 'ADMIN') && !row.mfa_enabled) {
      throw new ForbiddenException('MFA enrollment is required for owner and admin sessions');
    }
    request.userPrincipal = {
      userId: row.user_id,
      sessionId: row.session_id,
      institutionId: row.institution_id,
      role: row.role,
      email: row.email,
      institutionStatus: row.institution_status,
      mfaEnabled: row.mfa_enabled,
    };
    return true;
  }
}
