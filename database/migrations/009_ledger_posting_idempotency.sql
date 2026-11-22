ALTER TABLE journal_transactions
  ADD COLUMN request_hash CHAR(64);

CREATE INDEX journal_transactions_request_hash_idx
  ON journal_transactions(institution_id, request_hash)
  WHERE request_hash IS NOT NULL;
