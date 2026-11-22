import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { InstitutionPrincipal, UserPrincipal } from './api-key.types';

export const REQUIRED_SCOPES = 'requiredInstitutionScopes';

export const RequireInstitutionScopes = (...scopes: string[]) => SetMetadata(REQUIRED_SCOPES, scopes);

export const CurrentInstitution = createParamDecorator(
  (_data: unknown, context: ExecutionContext): InstitutionPrincipal => {
    const request = context.switchToHttp().getRequest<Request & { principal: InstitutionPrincipal }>();
    return request.principal;
  },
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserPrincipal => {
    const request = context.switchToHttp().getRequest<Request & { userPrincipal: UserPrincipal }>();
    return request.userPrincipal;
  },
);
