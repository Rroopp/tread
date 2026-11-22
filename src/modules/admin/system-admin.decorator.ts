import { SetMetadata } from '@nestjs/common';

export const SYSTEM_ADMIN_SCOPES = 'systemAdminScopes';
export const RequireSystemAdminScopes = (...scopes: string[]) => SetMetadata(SYSTEM_ADMIN_SCOPES, scopes);
