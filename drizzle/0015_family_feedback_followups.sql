ALTER TABLE family_usability_feedback ADD COLUMN response_id TEXT;
ALTER TABLE family_usability_feedback ADD COLUMN followup_outcome TEXT;
CREATE INDEX IF NOT EXISTS family_feedback_response_idx ON family_usability_feedback (tenant_id,response_id,created_at);
CREATE TABLE IF NOT EXISTS family_feedback_responses (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, feedback_id TEXT NOT NULL,
  kind TEXT NOT NULL, detail TEXT NOT NULL, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, voided_at TEXT, voided_by TEXT, void_reason TEXT
);
CREATE INDEX IF NOT EXISTS feedback_responses_source_idx ON family_feedback_responses (tenant_id,feedback_id,created_at);
