import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule, POSTGRES_POOL } from '../../database/database.module';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { PostgresThrottlerStorage } from './postgres-throttler.storage';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { InstitutionScopesGuard } from './institution-scopes.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordHasherService } from './password-hasher.service';
import { InstitutionRolesGuard } from './institution-roles.guard';
import { ApiKeysController } from './api-keys.controller';
import { TotpService } from './totp.service';
import { DataEncryptionService } from '../customers/data-encryption.service';
function clientIp(request: Record<string, any>): string {
  return typeof request.ip === 'string' ? request.ip : request.socket?.remoteAddress ?? 'unknown';
}

function apiKeyTracker(request: Record<string, any>): string {
  const authorization = request.headers?.authorization;
  const match = typeof authorization === 'string' ? authorization.match(/^Bearer\s+(\S+)$/i) : null;
  if (match) return `key:${createHash('sha256').update(match[1]).digest('hex')}`;
  return `anonymous:${clientIp(request)}`;
}

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('AUTH_ACCESS_TOKEN_SECRET'),
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [POSTGRES_POOL],
      useFactory: (pool: Pool) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 30, getTracker: (request: Record<string, any>) => `ip:${clientIp(request)}` },
          { name: 'api_key', ttl: 60_000, limit: 30, getTracker: apiKeyTracker },
        ],
        storage: new PostgresThrottlerStorage(pool),
        generateKey: (_context, tracker: string, name: string) => createHash('sha256').update(`${name}:${tracker}`).digest('hex'),
      }),
    }),
  ],
  controllers: [AuthController, ApiKeysController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    ApiKeyGuard,
    ApiKeyService,
    InstitutionScopesGuard,
    AuthService,
    JwtAuthGuard,
    PasswordHasherService,
    TotpService,
    DataEncryptionService,
    InstitutionRolesGuard,
  ],
  exports: [
    ApiKeyGuard,
    ApiKeyService,
    InstitutionScopesGuard,
    AuthService,
    JwtAuthGuard,
    PasswordHasherService,
    InstitutionRolesGuard,
    ThrottlerModule,
    JwtModule,
  ],
})
export class IdentityModule {}
