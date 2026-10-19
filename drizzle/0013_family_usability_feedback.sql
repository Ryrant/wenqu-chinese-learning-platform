CREATE TABLE IF NOT EXISTS family_usability_feedback (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, family_task_id TEXT NOT NULL,
  student_user_id TEXT NOT NULL, assignment_id TEXT, class_id TEXT,
  task_revision INTEGER NOT NULL, task_snapshot_json TEXT NOT NULL,
  participation TEXT NOT NULL, instructions TEXT NOT NULL, operation_help TEXT NOT NULL, alternative TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT, voided_by TEXT, void_reason TEXT
);
CREATE INDEX IF NOT EXISTS family_feedback_task_idx ON family_usability_feedback (tenant_id,family_task_id,created_at);
