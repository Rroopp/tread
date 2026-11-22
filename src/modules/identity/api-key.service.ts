import { BadRequestException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';

@Injectable()
export class ApiKeyService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async issueForEnvironment(
    institutionId: string,
    environment: 'SANDBOX' | 'PRODUCTION',
    name: string,
    scopes: string[],
    expiresAt: Date | undefined,
    createdBy: string,
  ) {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM institution_environments
       WHERE institution_id = $1 AND environment = $2 AND status = 'ACTIVE'`,
      [institutionId, environment],
    );
    const environmentId = result.rows[0]?.id;
    if (!environmentId) throw new NotFoundException('Active institution environment not found');
    return this.issue(institutionId, environmentId, name, scopes, expiresAt, createdBy);
  }

  async issue(
    institutionId: string,
    environmentId: string,
    name: string,
    scopes: string[],
    expiresAt?: Date,
    createdBy?: string,
  ): Promise<{ id: string; token: string; keyPrefix: string }> {
    const allowedScopes = new Set([
      'transactions:read', 'transactions:write', 'transactions:sandbox_simulate',
      'accounts:read', 'accounts:write', 'quotes:read', 'quotes:write',
      'webhooks:read', 'webhooks:write',
      'customers:read', 'customers:write', 'beneficiaries:read', 'beneficiaries:write',
    ]);
    if (!name.trim() || name.trim().length > 120 || scopes.length < 1 || scopes.some((scope) => !allowedScopes.has(scope))) {
      throw new BadRequestException('API key name and scopes are invalid');
    }
    if (expiresAt && expiresAt <= new Date()) throw new BadRequestException('API key expiration must be in the future');
    const environmentResult = await this.pool.query<{ environment: 'SANDBOX' | 'PRODUCTION' }>(
      `SELECT environment FROM institution_environments
       WHERE id = $1 AND institution_id = $2 AND status = 'ACTIVE'`,
      [environmentId, institutionId],
    );
    const environment = environmentResult.rows[0]?.environment;
    if (!environment) throw new Error('An active institution environment is required to issue an API key');

    const prefix = environment === 'SANDBOX' ? 'tr_sbx' : 'tr_live';
    const keyPrefix = `${prefix}_${randomBytes(6).toString('hex')}`;
    const token = `${keyPrefix}.${randomBytes(32).toString('base64url')}`;
    const secretHash = createHash('sha256').update(token).digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `INSERT INTO api_credentials
          (institution_id, environment_id, name, key_prefix, secret_hash, scopes, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [institutionId, environmentId, name.trim(), keyPrefix, secretHash, scopes, expiresAt ?? null, createdBy ?? null],
      );
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'api_credential.created', 'api_credential', $3, $4::jsonb)`,
        [institutionId, createdBy ?? null, result.rows[0].id, JSON.stringify({ keyPrefix, environment, scopes })],
      );
      await client.query('COMMIT');
      return { id: result.rows[0].id, token, keyPrefix };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async list(institutionId: string) {
    const result = await this.pool.query(
      `SELECT c.id, c.environment_id, e.environment, c.name, c.key_prefix, c.scopes,
              c.expires_at, c.last_used_at, c.revoked_at, c.created_at
       FROM api_credentials c
       JOIN institution_environments e ON e.id = c.environment_id
       WHERE c.institution_id = $1
       ORDER BY c.created_at DESC LIMIT 100`,
      [institutionId],
    );
    return { credentials: result.rows };
  }

  async revoke(institutionId: string, credentialId: string, actorUserId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE api_credentials SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = $1 AND institution_id = $2 AND revoked_at IS NULL
         RETURNING id, key_prefix, environment_id`,
        [credentialId, institutionId],
      );
      const credential = result.rows[0];
      if (!credential) throw new NotFoundException('Active API credential not found');
      await client.query(
        `INSERT INTO audit_logs (institution_id, actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'api_credential.revoked', 'api_credential', $3, $4::jsonb)`,
        [institutionId, actorUserId, credential.id, JSON.stringify({ keyPrefix: credential.key_prefix, environmentId: credential.environment_id })],
      );
      await client.query('COMMIT');
      return { id: credential.id, status: 'REVOKED' };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve original failure. */ }
      throw error;
    } finally {
      client.release();
    }
  }
}
