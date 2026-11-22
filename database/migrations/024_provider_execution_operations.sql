CREATE TABLE provider_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  transaction_id UUID NOT NULL,
  provider_code TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  source_asset_code TEXT NOT NULL REFERENCES assets(code),
  destination_asset_code TEXT NOT NULL REFERENCES assets(code),
  source_amount_minor NUMERIC(38, 0) NOT NULL CHECK (source_amount_minor > 0),
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED')),
  retry_disposition TEXT NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK (retry_disposition IN ('SAFE_TO_RETRY', 'DO_NOT_RETRY', 'NOT_APPLICABLE')),
  next_attempt_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  FOREIGN KEY (transaction_id, institution_id, environment_id)
    REFERENCES financial_transactions(id, institution_id, environment_id),
  UNIQUE (institution_id, environment_id, provider_code, idempotency_key),
  UNIQUE (id, transaction_id, institution_id, environment_id)
);

CREATE INDEX provider_operations_transaction_idx
  ON provider_operations(institution_id, environment_id, transaction_id, created_at DESC);
CREATE INDEX provider_operations_retry_idx
  ON provider_operations(next_attempt_at) WHERE status = 'FAILED' AND retry_disposition = 'SAFE_TO_RETRY';

ALTER TABLE provider_attempts ADD COLUMN operation_id UUID;
ALTER TABLE provider_attempts ADD CONSTRAINT provider_attempts_operation_fk
  FOREIGN KEY (operation_id, transaction_id, institution_id, environment_id)
  REFERENCES provider_operations(id, transaction_id, institution_id, environment_id);
CREATE INDEX provider_attempts_operation_idx ON provider_attempts(operation_id, attempt_number);
