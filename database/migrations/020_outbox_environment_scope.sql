ALTER TABLE outbox_events
  ADD COLUMN environment_id UUID;

-- Recover environment ownership for pending events from their aggregate rows.
UPDATE outbox_events o SET environment_id = source.environment_id
FROM (
  SELECT 'financial_transaction'::text AS aggregate_type, id, institution_id, environment_id FROM financial_transactions
  UNION ALL SELECT 'quote', id, institution_id, environment_id FROM quotes
  UNION ALL SELECT 'account', id, institution_id, environment_id FROM accounts
  UNION ALL SELECT 'account_hold', id, institution_id, environment_id FROM account_holds
  UNION ALL SELECT 'reconciliation_batch', id, institution_id, environment_id FROM reconciliation_batches
) source
WHERE o.aggregate_id = source.id
  AND o.aggregate_type = source.aggregate_type
  AND o.institution_id = source.institution_id
  AND o.environment_id IS NULL;

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_environment_tenant_fk
  FOREIGN KEY (environment_id, institution_id)
  REFERENCES institution_environments(id, institution_id);

CREATE INDEX outbox_events_pending_environment_idx
  ON outbox_events(institution_id, environment_id, occurred_at, id)
  WHERE published_at IS NULL;
