CREATE TABLE user_mfa (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  secret_key_id TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_auth_tag TEXT NOT NULL,
  enabled_at TIMESTAMPTZ,
  last_totp_step BIGINT NOT NULL DEFAULT -1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_mfa_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_mfa(user_id),
  code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ,
  UNIQUE (user_id, code_hash)
);

CREATE INDEX user_mfa_recovery_codes_active_idx
  ON user_mfa_recovery_codes(user_id, created_at)
  WHERE consumed_at IS NULL;
