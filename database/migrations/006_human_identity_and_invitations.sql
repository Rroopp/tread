CREATE TABLE institution_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id),
  email TEXT NOT NULL,
  email_normalized TEXT GENERATED ALWAYS AS (lower(trim(email))) STORED,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER', 'COMPLIANCE')),
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by_user_id UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT institution_invitations_email_valid
    CHECK (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

CREATE UNIQUE INDEX institution_invitations_active_email_idx
  ON institution_invitations(institution_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX institution_invitations_pending_idx
  ON institution_invitations(institution_id, created_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY (institution_id, user_id)
    REFERENCES institution_memberships(institution_id, user_id),
  UNIQUE (id, user_id, institution_id)
);

CREATE INDEX user_sessions_active_user_idx
  ON user_sessions(user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE user_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  user_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY (session_id, user_id, institution_id)
    REFERENCES user_sessions(id, user_id, institution_id)
);

CREATE INDEX user_refresh_tokens_session_idx
  ON user_refresh_tokens(session_id, created_at DESC);
