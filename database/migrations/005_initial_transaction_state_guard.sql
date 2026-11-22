CREATE FUNCTION require_created_transaction_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'CREATED' THEN
    RAISE EXCEPTION 'New financial transactions must start in CREATED state'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER financial_transaction_initial_state_guard
  BEFORE INSERT ON financial_transactions
  FOR EACH ROW EXECUTE FUNCTION require_created_transaction_state();
