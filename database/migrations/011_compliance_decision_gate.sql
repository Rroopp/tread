ALTER TABLE financial_transactions
  ADD CONSTRAINT financial_transactions_id_tenant_environment_unique
  UNIQUE (id, institution_id, environment_id);

CREATE TABLE transaction_compliance_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  institution_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  check_type TEXT NOT NULL CHECK (check_type IN ('SANCTIONS', 'AML', 'JURISDICTION', 'TRANSACTION_ELIGIBILITY')),
  provider_code TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ALLOW', 'DENY', 'REVIEW')),
  decision_mode TEXT NOT NULL CHECK (decision_mode IN ('SANDBOX_SIMULATED', 'LIVE')),
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (transaction_id, institution_id, environment_id)
    REFERENCES financial_transactions(id, institution_id, environment_id)
);

CREATE INDEX transaction_compliance_latest_idx
  ON transaction_compliance_decisions(transaction_id, created_at DESC, id DESC);

CREATE FUNCTION require_compliance_allow_before_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  environment_name TEXT;
  has_allow BOOLEAN;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'APPROVED' THEN
    SELECT e.environment INTO environment_name
    FROM institution_environments e
    WHERE e.id = NEW.environment_id AND e.institution_id = NEW.institution_id;

    SELECT EXISTS (
      SELECT 1 FROM transaction_compliance_decisions d
      WHERE d.transaction_id = NEW.id
        AND d.institution_id = NEW.institution_id
        AND d.environment_id = NEW.environment_id
        AND d.decision = 'ALLOW'
        AND ((environment_name = 'SANDBOX' AND d.decision_mode = 'SANDBOX_SIMULATED')
          OR (environment_name = 'PRODUCTION' AND d.decision_mode = 'LIVE'))
    ) INTO has_allow;

    IF NOT has_allow THEN
      RAISE EXCEPTION 'Transaction approval requires a matching compliance ALLOW decision'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_transaction_compliance_gate
  BEFORE UPDATE OF status ON financial_transactions
  FOR EACH ROW EXECUTE FUNCTION require_compliance_allow_before_approval();

CREATE FUNCTION protect_compliance_decisions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Compliance decision history is append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER compliance_decisions_are_append_only
  BEFORE UPDATE OR DELETE ON transaction_compliance_decisions
  FOR EACH ROW EXECUTE FUNCTION protect_compliance_decisions();
