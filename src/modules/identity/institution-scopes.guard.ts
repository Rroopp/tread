import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES } from './api-key.decorator';
import { InstitutionPrincipal } from './api-key.types';

@Injectable()
export class InstitutionScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    if (requiredScopes.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ principal?: InstitutionPrincipal }>();
    const granted = new Set(request.principal?.scopes ?? []);
    if (!requiredScopes.every((scope) => granted.has(scope))) {
      throw new ForbiddenException('API key does not have the required scope');
    }
    return true;
  }
}
