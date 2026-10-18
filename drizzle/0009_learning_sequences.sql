CREATE TABLE IF NOT EXISTS learning_sequences (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_user_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL, objective_id TEXT NOT NULL, objective_title TEXT NOT NULL,
  baseline_submission_id TEXT NOT NULL, baseline_snapshot_json TEXT NOT NULL,
  title TEXT NOT NULL, practice_prompt TEXT NOT NULL, transfer_prompt TEXT NOT NULL, transfer_context TEXT NOT NULL,
  rubric_json TEXT NOT NULL, medium TEXT NOT NULL, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS learning_sequences_student_idx ON learning_sequences (tenant_id, student_user_id);
ALTER TABLE submissions ADD COLUMN sequence_id TEXT;
ALTER TABLE submissions ADD COLUMN sequence_stage TEXT;
ALTER TABLE submissions ADD COLUMN sequence_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE submission_reviews ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS sequence_submission_pending_idx ON submissions (tenant_id, sequence_id, sequence_stage)
  WHERE sequence_id IS NOT NULL AND review_status!='reviewed';
