CREATE TABLE IF NOT EXISTS learning_trial_records (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sequence_id TEXT NOT NULL,
  kind TEXT NOT NULL, method TEXT, minutes INTEGER,
  reference_submission_id TEXT, reference_title TEXT, note TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT, voided_by TEXT, void_reason TEXT
);
CREATE INDEX IF NOT EXISTS trial_records_sequence_idx ON learning_trial_records (tenant_id, sequence_id, created_at);
