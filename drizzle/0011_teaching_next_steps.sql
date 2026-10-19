CREATE TABLE IF NOT EXISTS learning_sequence_decisions (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, sequence_id TEXT NOT NULL,
  reference_submission_id TEXT NOT NULL, reference_snapshot_json TEXT NOT NULL,
  kind TEXT NOT NULL, rationale TEXT NOT NULL, remaining TEXT NOT NULL,
  next_sequence_id TEXT NOT NULL, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS sequence_decision_reference_idx ON learning_sequence_decisions (tenant_id, sequence_id, reference_submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS sequence_decision_next_idx ON learning_sequence_decisions (tenant_id, next_sequence_id);
