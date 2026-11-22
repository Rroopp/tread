CREATE FUNCTION valid_transaction_transition(current_status TEXT, next_status TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE current_status
    WHEN 'CREATED' THEN next_status IN ('QUOTED', 'COMPLIANCE_PENDING', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW')
    WHEN 'QUOTED' THEN next_status IN ('AWAITING_FUNDING', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW')
    WHEN 'AWAITING_FUNDING' THEN next_status IN ('FUNDED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW')
    WHEN 'FUNDED' THEN next_status IN ('COMPLIANCE_PENDING', 'APPROVED', 'FAILED', 'REQUIRES_REVIEW')
    WHEN 'COMPLIANCE_PENDING' THEN next_status IN ('APPROVED', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW')
    WHEN 'APPROVED' THEN next_status IN ('EXECUTING', 'FAILED', 'CANCELLED', 'REQUIRES_REVIEW')
    WHEN 'EXECUTING' THEN next_status IN ('BROADCAST', 'SETTLED', 'FAILED', 'REQUIRES_REVIEW')
    WHEN 'BROADCAST' THEN next_status IN ('CONFIRMING', 'SETTLED', 'FAILED', 'REQUIRES_REVIEW')
    WHEN 'CONFIRMING' THEN next_status IN ('SETTLED', 'FAILED', 'REQUIRES_REVIEW')
    WHEN 'SETTLED' THEN next_status IN ('RECONCILED', 'REQUIRES_REVIEW')
    WHEN 'REQUIRES_REVIEW' THEN next_status IN ('COMPLIANCE_PENDING', 'APPROVED', 'EXECUTING', 'FAILED', 'CANCELLED')
    ELSE FALSE
  END
$$;

CREATE FUNCTION guard_transaction_status_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT valid_transaction_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'Invalid transaction transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_transaction_transition_guard
  BEFORE UPDATE OF status ON financial_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_transaction_status_transition();

CREATE FUNCTION reject_transaction_transition_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Transaction transition history is append-only'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER transaction_transitions_are_append_only
  BEFORE UPDATE OR DELETE ON transaction_transitions
  FOR EACH ROW EXECUTE FUNCTION reject_transaction_transition_mutation();
