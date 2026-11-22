CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_auth_tag TEXT NOT NULL,
  event_types TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (id, institution_id, environment_id)
);

CREATE INDEX webhook_endpoints_active_idx
  ON webhook_endpoints(institution_id, environment_id, created_at DESC)
  WHERE status = 'ACTIVE';

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  endpoint_id UUID NOT NULL,
  outbox_event_id UUID NOT NULL REFERENCES outbox_events(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'DELIVERING', 'RETRYING', 'DELIVERED', 'DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  last_http_status SMALLINT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  FOREIGN KEY (endpoint_id, institution_id, environment_id)
    REFERENCES webhook_endpoints(id, institution_id, environment_id),
  UNIQUE (endpoint_id, outbox_event_id)
);

CREATE INDEX webhook_deliveries_due_idx
  ON webhook_deliveries(next_attempt_at, created_at)
  WHERE status IN ('PENDING', 'RETRYING', 'DELIVERING');
CREATE INDEX webhook_deliveries_tenant_recent_idx
  ON webhook_deliveries(institution_id, environment_id, created_at DESC);
