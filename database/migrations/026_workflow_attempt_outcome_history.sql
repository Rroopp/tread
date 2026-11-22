ALTER TABLE transfer_workflow_attempt_results
  ADD COLUMN result_number INTEGER NOT NULL DEFAULT 1 CHECK (result_number > 0);

ALTER TABLE transfer_workflow_attempt_results
  DROP CONSTRAINT transfer_workflow_attempt_results_attempt_id_key;

ALTER TABLE transfer_workflow_attempt_results
  ADD CONSTRAINT transfer_workflow_attempt_results_attempt_sequence_unique
  UNIQUE (attempt_id, result_number);
