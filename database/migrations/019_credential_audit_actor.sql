ALTER TABLE audit_logs
  ADD COLUMN actor_credential_id UUID REFERENCES api_credentials(id);

CREATE INDEX audit_logs_actor_credential_idx
  ON audit_logs(actor_credential_id, created_at DESC)
  WHERE actor_credential_id IS NOT NULL;
