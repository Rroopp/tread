export interface InstitutionPrincipal {
  institutionId: string;
  environmentId: string;
  environment: 'SANDBOX' | 'PRODUCTION';
  credentialId: string;
  scopes: string[];
}

export interface UserPrincipal {
  userId: string;
  sessionId: string;
  institutionId: string;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER' | 'COMPLIANCE';
  email: string;
  institutionStatus: 'PENDING_REVIEW' | 'ACTIVE';
  mfaEnabled?: boolean;
}
