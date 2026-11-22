import { SetMetadata } from '@nestjs/common';
import { UserPrincipal } from './api-key.types';

export const REQUIRED_INSTITUTION_ROLES = 'requiredInstitutionRoles';
export type InstitutionRole = UserPrincipal['role'];

export const RequireInstitutionRoles = (...roles: InstitutionRole[]) =>
  SetMetadata(REQUIRED_INSTITUTION_ROLES, roles);
