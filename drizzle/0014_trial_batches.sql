CREATE TABLE IF NOT EXISTS learning_trial_batches (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, class_id TEXT NOT NULL,
  title TEXT NOT NULL, scope_json TEXT NOT NULL, request_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT, voided_by TEXT, void_reason TEXT
);
CREATE INDEX IF NOT EXISTS trial_batches_class_idx ON learning_trial_batches (tenant_id,class_id,created_at);
