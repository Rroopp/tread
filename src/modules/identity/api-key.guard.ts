import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { InstitutionPrincipal } from './api-key.types';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { principal?: InstitutionPrincipal }>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer (\S+)$/i);
    if (!match) throw new UnauthorizedException('A valid API key is required');

    const [keyPrefix, secret, extra] = match[1].split('.');
    if (extra !== undefined || !/^tr_(sbx|live)_[a-f0-9]{12}$/.test(keyPrefix) || !secret) {
      throw new UnauthorizedException('A valid API key is required');
    }

    const result = await this.pool.query<{
      credential_id: string;
      institution_id: string;
      environment_id: string;
      environment: 'SANDBOX' | 'PRODUCTION';
      secret_hash: string;
      scopes: string[];
    }>(
      `SELECT c.id AS credential_id, c.institution_id, c.environment_id,
              e.environment, c.secret_hash, c.scopes
       FROM api_credentials c
       JOIN institution_environments e
         ON e.id = c.environment_id AND e.institution_id = c.institution_id
       JOIN institutions i ON i.id = c.institution_id
       WHERE c.key_prefix = $1
         AND c.revoked_at IS NULL
         AND (c.expires_at IS NULL OR c.expires_at > now())
         AND e.status = 'ACTIVE'
         AND i.status = 'ACTIVE'
       LIMIT 1`,
      [keyPrefix],
    );
    const credential = result.rows[0];
    if (!credential || !this.hashMatches(match[1], credential.secret_hash)) {
      throw new UnauthorizedException('A valid API key is required');
    }

    const expectedEnvironment = keyPrefix.startsWith('tr_sbx_') ? 'SANDBOX' : 'PRODUCTION';
    if (credential.environment !== expectedEnvironment) {
      throw new UnauthorizedException('API key environment mismatch');
    }

    request.principal = {
      institutionId: credential.institution_id,
      environmentId: credential.environment_id,
      environment: credential.environment,
      credentialId: credential.credential_id,
      scopes: credential.scopes,
    };
    await this.pool.query('UPDATE api_credentials SET last_used_at = now() WHERE id = $1', [credential.credential_id]);
    return true;
  }

  private hashMatches(token: string, storedHexHash: string): boolean {
    const presentedHash = createHash('sha256').update(token).digest();
    const storedHash = Buffer.from(storedHexHash, 'hex');
    return storedHash.length === presentedHash.length && timingSafeEqual(presentedHash, storedHash);
  }
}
