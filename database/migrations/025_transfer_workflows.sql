CREATE TABLE transfer_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  transaction_id UUID NOT NULL,
  workflow_type TEXT NOT NULL DEFAULT 'KES_USDC_OFFRAMP',
  status TEXT NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'WAITING_RECONCILIATION', 'COMPENSATION_REQUIRED', 'FAILED', 'SETTLED', 'RECOVERY_COMPLETE')),
  policy_version TEXT NOT NULL,
  policy_snapshot JSONB NOT NULL,
  policy_hash CHAR(64) NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  simulated BOOLEAN NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (transaction_id, institution_id, environment_id)
    REFERENCES financial_transactions(id, institution_id, environment_id),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (institution_id, environment_id, transaction_id, workflow_type),
  UNIQUE (institution_id, environment_id, idempotency_key),
  UNIQUE (id, institution_id, environment_id)
);

CREATE TABLE transfer_workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  step_key TEXT NOT NULL,
  step_kind TEXT NOT NULL CHECK (step_kind IN ('FORWARD', 'COMPENSATION')),
  ordinal SMALLINT NOT NULL CHECK (ordinal > 0),
  status TEXT NOT NULL CHECK (status IN ('BLOCKED', 'READY', 'RUNNING', 'RETRY_WAIT', 'RECONCILIATION_PENDING', 'SUCCEEDED', 'FAILED', 'COMPENSATION_REQUIRED', 'COMPENSATED', 'SKIPPED')),
  depends_on_step_id UUID,
  compensates_step_id UUID,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64),
  retry_policy JSONB NOT NULL,
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms > 0),
  max_attempts INTEGER NOT NULL CHECK (max_attempts > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  retry_disposition TEXT NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK (retry_disposition IN ('SAFE_TO_RETRY', 'DO_NOT_RETRY', 'NOT_APPLICABLE')),
  next_attempt_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  unknown_since TIMESTAMPTZ,
  provider_reference TEXT,
  result JSONB,
  terminal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (workflow_id, institution_id, environment_id)
    REFERENCES transfer_workflows(id, institution_id, environment_id),
  FOREIGN KEY (depends_on_step_id, workflow_id, institution_id, environment_id)
    REFERENCES transfer_workflow_steps(id, workflow_id, institution_id, environment_id),
  FOREIGN KEY (compensates_step_id, workflow_id, institution_id, environment_id)
    REFERENCES transfer_workflow_steps(id, workflow_id, institution_id, environment_id),
  FOREIGN KEY (environment_id, institution_id)
    REFERENCES institution_environments(id, institution_id),
  UNIQUE (workflow_id, step_key, generation),
  UNIQUE (workflow_id, ordinal),
  UNIQUE (institution_id, environment_id, idempotency_key),
  UNIQUE (id, workflow_id, institution_id, environment_id)
);

CREATE INDEX transfer_workflow_steps_claim_idx
  ON transfer_workflow_steps(status, next_attempt_at, lease_expires_at, ordinal)
  WHERE status IN ('READY', 'RETRY_WAIT', 'RUNNING');
CREATE INDEX transfer_workflows_tenant_status_idx
  ON transfer_workflows(institution_id, environment_id, status, updated_at DESC);

CREATE TABLE transfer_workflow_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id UUID NOT NULL,
  workflow_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  idempotency_key TEXT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status = 'SUBMITTED'),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  FOREIGN KEY (step_id, workflow_id, institution_id, environment_id)
    REFERENCES transfer_workflow_steps(id, workflow_id, institution_id, environment_id),
  UNIQUE (step_id, attempt_number),
  UNIQUE (idempotency_key, attempt_number),
  UNIQUE (id, step_id, workflow_id, institution_id, environment_id)
);
CREATE INDEX transfer_workflow_attempts_scope_idx
  ON transfer_workflow_attempts(institution_id, environment_id, workflow_id, submitted_at DESC);

CREATE TABLE transfer_workflow_attempt_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL,
  step_id UUID NOT NULL,
  workflow_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  outcome_class TEXT NOT NULL CHECK (outcome_class IN ('DEFINITE_SUCCESS', 'DEFINITE_FAILURE', 'UNKNOWN')),
  provider_reference TEXT,
  outcome JSONB NOT NULL DEFAULT '{}',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (attempt_id, step_id, workflow_id, institution_id, environment_id)
    REFERENCES transfer_workflow_attempts(id, step_id, workflow_id, institution_id, environment_id),
  UNIQUE (attempt_id)
);

CREATE TABLE transfer_workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL,
  step_id UUID,
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'USER', 'CREDENTIAL', 'WORKER', 'PROVIDER')),
  actor_id UUID,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (workflow_id, institution_id, environment_id)
    REFERENCES transfer_workflows(id, institution_id, environment_id),
  FOREIGN KEY (step_id, workflow_id, institution_id, environment_id)
    REFERENCES transfer_workflow_steps(id, workflow_id, institution_id, environment_id),
  UNIQUE (workflow_id, sequence)
);
CREATE INDEX transfer_workflow_events_scope_idx
  ON transfer_workflow_events(institution_id, environment_id, workflow_id, sequence);

CREATE FUNCTION prevent_transfer_workflow_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Transfer workflow attempts and events are append-only'
    USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER transfer_workflow_attempts_are_append_only
  BEFORE UPDATE OR DELETE ON transfer_workflow_attempts
  FOR EACH ROW EXECUTE FUNCTION prevent_transfer_workflow_history_mutation();
CREATE TRIGGER transfer_workflow_attempt_results_are_append_only
  BEFORE UPDATE OR DELETE ON transfer_workflow_attempt_results
  FOR EACH ROW EXECUTE FUNCTION prevent_transfer_workflow_history_mutation();
CREATE TRIGGER transfer_workflow_events_are_append_only
  BEFORE UPDATE OR DELETE ON transfer_workflow_events
  FOR EACH ROW EXECUTE FUNCTION prevent_transfer_workflow_history_mutation();
