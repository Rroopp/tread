CREATE OR REPLACE FUNCTION require_compliance_allow_before_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  environment_name TEXT;
  latest_decision TEXT;
  latest_mode TEXT;
  live_check_count BIGINT;
  all_live_checks_allowed BOOLEAN;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'APPROVED' THEN
    SELECT e.environment INTO environment_name
    FROM institution_environments e
    WHERE e.id = NEW.environment_id AND e.institution_id = NEW.institution_id;

    IF environment_name = 'SANDBOX' THEN
      SELECT d.decision, d.decision_mode INTO latest_decision, latest_mode
      FROM transaction_compliance_decisions d
      WHERE d.transaction_id = NEW.id AND d.institution_id = NEW.institution_id
        AND d.environment_id = NEW.environment_id AND d.check_type = 'TRANSACTION_ELIGIBILITY'
      ORDER BY d.created_at DESC, d.id DESC LIMIT 1;
      IF latest_decision IS DISTINCT FROM 'ALLOW' OR latest_mode IS DISTINCT FROM 'SANDBOX_SIMULATED' THEN
        RAISE EXCEPTION 'Sandbox approval requires the latest simulated compliance decision to allow'
          USING ERRCODE = '23514';
      END IF;
    ELSIF environment_name = 'PRODUCTION' THEN
      SELECT count(*), COALESCE(bool_and(decision = 'ALLOW' AND decision_mode = 'LIVE'), false)
      INTO live_check_count, all_live_checks_allowed
      FROM (
        SELECT DISTINCT ON (check_type) check_type, decision, decision_mode
        FROM transaction_compliance_decisions
        WHERE transaction_id = NEW.id AND institution_id = NEW.institution_id
          AND environment_id = NEW.environment_id
          AND check_type IN ('SANCTIONS', 'AML', 'JURISDICTION', 'TRANSACTION_ELIGIBILITY')
        ORDER BY check_type, created_at DESC, id DESC
      ) latest;
      IF live_check_count <> 4 OR NOT all_live_checks_allowed THEN
        RAISE EXCEPTION 'Production approval requires the latest live ALLOW decision for every mandatory compliance check'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Institution environment is unavailable for approval'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
