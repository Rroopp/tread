ALTER TABLE accounts ADD COLUMN normal_balance TEXT NOT NULL DEFAULT 'DEBIT'
  CHECK (normal_balance IN ('DEBIT', 'CREDIT'));

UPDATE accounts SET normal_balance = CASE account_type
  WHEN 'CUSTOMER' THEN 'CREDIT'
  WHEN 'FEE' THEN 'CREDIT'
  ELSE 'DEBIT'
END;

ALTER TABLE account_holds
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN request_hash CHAR(64);

CREATE UNIQUE INDEX account_holds_idempotency_unique
  ON account_holds(institution_id, environment_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE journal_transactions
  ADD COLUMN reversal_of_journal_id UUID,
  ADD CONSTRAINT journal_transactions_reversal_fk
    FOREIGN KEY (reversal_of_journal_id, institution_id, asset_code, environment_id)
    REFERENCES journal_transactions(id, institution_id, asset_code, environment_id),
  ADD CONSTRAINT journal_transactions_single_reversal
    UNIQUE (reversal_of_journal_id);
