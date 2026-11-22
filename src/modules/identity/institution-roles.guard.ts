import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserPrincipal } from './api-key.types';
import { REQUIRED_INSTITUTION_ROLES, InstitutionRole } from './institution-roles.decorator';

@Injectable()
export class InstitutionRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<InstitutionRole[]>(REQUIRED_INSTITUTION_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    if (required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ userPrincipal?: UserPrincipal }>();
    if (!request.userPrincipal || !required.includes(request.userPrincipal.role)) {
      throw new ForbiddenException('Your institution role cannot perform this action');
    }
    if ((request.userPrincipal.role === 'OWNER' || request.userPrincipal.role === 'ADMIN') && !request.userPrincipal.mfaEnabled) {
      throw new ForbiddenException('MFA enrollment is required before using owner or admin controls');
    }
    return true;
  }
}
