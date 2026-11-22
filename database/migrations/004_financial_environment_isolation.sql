ALTER TABLE accounts
  ADD CONSTRAINT accounts_id_tenant_asset_environment_unique
  UNIQUE (id, institution_id, asset_code, environment_id);

ALTER TABLE financial_transactions
  ADD CONSTRAINT financial_transactions_id_tenant_asset_environment_unique
  UNIQUE (id, institution_id, asset_code, environment_id);

ALTER TABLE journal_transactions ADD COLUMN environment_id UUID;

UPDATE journal_transactions j
SET environment_id = t.environment_id
FROM financial_transactions t
WHERE j.financial_transaction_id = t.id
  AND j.institution_id = t.institution_id
  AND j.asset_code = t.asset_code;

UPDATE journal_transactions j
SET environment_id = ledger_env.environment_id
FROM (
  SELECT le.journal_transaction_id, min(a.environment_id::text)::uuid AS environment_id
  FROM ledger_entries le
  JOIN accounts a ON a.id = le.account_id
  GROUP BY le.journal_transaction_id
  HAVING count(DISTINCT a.environment_id) = 1
) ledger_env
WHERE j.id = ledger_env.journal_transaction_id
  AND j.environment_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM journal_transactions WHERE environment_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot determine environment for every existing journal transaction';
  END IF;
END;
$$;

ALTER TABLE journal_transactions ALTER COLUMN environment_id SET NOT NULL;
ALTER TABLE journal_transactions
  ADD CONSTRAINT journal_transactions_environment_fk
  FOREIGN KEY (environment_id, institution_id)
  REFERENCES institution_environments(id, institution_id);
ALTER TABLE journal_transactions
  ADD CONSTRAINT journal_transactions_id_tenant_asset_environment_unique
  UNIQUE (id, institution_id, asset_code, environment_id);
ALTER TABLE journal_transactions
  ADD CONSTRAINT journal_transactions_financial_environment_fk
  FOREIGN KEY (financial_transaction_id, institution_id, asset_code, environment_id)
  REFERENCES financial_transactions(id, institution_id, asset_code, environment_id);

ALTER TABLE ledger_entries ADD COLUMN environment_id UUID;
UPDATE ledger_entries le
SET environment_id = j.environment_id
FROM journal_transactions j
WHERE le.journal_transaction_id = j.id;
ALTER TABLE ledger_entries ALTER COLUMN environment_id SET NOT NULL;
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_journal_environment_fk
  FOREIGN KEY (journal_transaction_id, institution_id, asset_code, environment_id)
  REFERENCES journal_transactions(id, institution_id, asset_code, environment_id);
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_account_environment_fk
  FOREIGN KEY (account_id, institution_id, asset_code, environment_id)
  REFERENCES accounts(id, institution_id, asset_code, environment_id);

ALTER TABLE account_holds ADD COLUMN environment_id UUID;
UPDATE account_holds h
SET environment_id = a.environment_id
FROM accounts a
WHERE h.account_id = a.id;
ALTER TABLE account_holds ALTER COLUMN environment_id SET NOT NULL;
ALTER TABLE account_holds
  ADD CONSTRAINT account_holds_account_environment_fk
  FOREIGN KEY (account_id, institution_id, asset_code, environment_id)
  REFERENCES accounts(id, institution_id, asset_code, environment_id);
ALTER TABLE account_holds
  ADD CONSTRAINT account_holds_transaction_environment_fk
  FOREIGN KEY (transaction_id, institution_id, asset_code, environment_id)
  REFERENCES financial_transactions(id, institution_id, asset_code, environment_id);
