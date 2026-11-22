import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { POSTGRES_POOL } from '../../database/database.module';
import { UserPrincipal } from '../identity/api-key.types';
import { SYSTEM_ADMIN_SCOPES } from './system-admin.decorator';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ userPrincipal?: UserPrincipal }>();
    const principal = request.userPrincipal;
    if (!principal) throw new UnauthorizedException();
    const required = this.reflector.getAllAndOverride<string[]>(SYSTEM_ADMIN_SCOPES, [context.getHandler(), context.getClass()]) ?? [];
    const result = await this.pool.query<{ scopes: string[] }>(
      `SELECT scopes FROM system_admin_grants WHERE user_id = $1 AND status = 'ACTIVE'`, [principal.userId],
    );
    const scopes = result.rows[0]?.scopes;
    if (!scopes) throw new ForbiddenException('Internal administrator access is required');
    if (!required.every((scope) => scopes.includes(scope))) throw new ForbiddenException('Internal administrator scope is missing');
    return true;
  }
}
