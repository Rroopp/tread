CREATE TABLE provider_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  transaction_id UUID NOT NULL,
  provider_code TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  provider_reference TEXT,
  settlement_asset_code TEXT REFERENCES assets(code),
  settlement_amount_minor NUMERIC(38, 0) CHECK (settlement_amount_minor IS NULL OR settlement_amount_minor >= 0),
  request_metadata JSONB NOT NULL DEFAULT '{}',
  response_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (transaction_id, institution_id, environment_id)
    REFERENCES financial_transactions(id, institution_id, environment_id),
  UNIQUE (transaction_id, provider_code, attempt_number),
  UNIQUE (institution_id, environment_id, provider_code, idempotency_key),
  UNIQUE (id, transaction_id, institution_id, environment_id)
);

CREATE UNIQUE INDEX provider_attempt_reference_unique
  ON provider_attempts(provider_code, provider_reference)
  WHERE provider_reference IS NOT NULL;
CREATE INDEX provider_attempts_transaction_idx
  ON provider_attempts(institution_id, environment_id, transaction_id, created_at DESC);

CREATE TABLE reconciliation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  provider_code TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0),
  matched_count INTEGER NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  variance_count INTEGER NOT NULL DEFAULT 0 CHECK (variance_count >= 0),
  unmatched_count INTEGER NOT NULL DEFAULT 0 CHECK (unmatched_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (institution_id, environment_id, provider_code, idempotency_key),
  UNIQUE (id, institution_id, environment_id)
);

CREATE TABLE reconciliation_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  provider_code TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  provider_attempt_id UUID,
  transaction_id UUID,
  observed_status TEXT NOT NULL,
  observed_asset_code TEXT NOT NULL REFERENCES assets(code),
  observed_amount_minor NUMERIC(38, 0) NOT NULL CHECK (observed_amount_minor >= 0),
  expected_asset_code TEXT REFERENCES assets(code),
  expected_amount_minor NUMERIC(38, 0) CHECK (expected_amount_minor IS NULL OR expected_amount_minor >= 0),
  result TEXT NOT NULL CHECK (result IN ('MATCHED', 'VARIANCE', 'UNMATCHED', 'PENDING')),
  details JSONB NOT NULL DEFAULT '{}',
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (batch_id, institution_id, environment_id)
    REFERENCES reconciliation_batches(id, institution_id, environment_id),
  FOREIGN KEY (provider_attempt_id, transaction_id, institution_id, environment_id)
    REFERENCES provider_attempts(id, transaction_id, institution_id, environment_id),
  FOREIGN KEY (transaction_id, institution_id, environment_id)
    REFERENCES financial_transactions(id, institution_id, environment_id),
  UNIQUE (batch_id, provider_reference)
);

CREATE INDEX reconciliation_observations_batch_idx
  ON reconciliation_observations(batch_id, created_at);
CREATE INDEX reconciliation_observations_result_idx
  ON reconciliation_observations(institution_id, environment_id, result, created_at DESC);

CREATE FUNCTION protect_reconciliation_observations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reconciliation observations are append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER reconciliation_observations_are_append_only
  BEFORE UPDATE OR DELETE ON reconciliation_observations
  FOR EACH ROW EXECUTE FUNCTION protect_reconciliation_observations();
