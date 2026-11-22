import { InstitutionPrincipal, UserPrincipal } from './api-key.types';

declare module 'express-serve-static-core' {
  interface Request {
    principal?: InstitutionPrincipal;
    userPrincipal?: UserPrincipal;
  }
}
