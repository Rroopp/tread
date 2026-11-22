ALTER TABLE transaction_transitions
  ADD COLUMN actor_credential_id UUID REFERENCES api_credentials(id);

CREATE UNIQUE INDEX api_credentials_active_prefix_unique
  ON api_credentials(key_prefix) WHERE revoked_at IS NULL;
