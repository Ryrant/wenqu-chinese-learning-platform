ALTER TABLE learning_sequences ADD COLUMN retest_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE learning_sequences ADD COLUMN retest_context TEXT NOT NULL DEFAULT '';
ALTER TABLE learning_sequences ADD COLUMN retest_available_at TEXT;
ALTER TABLE learning_sequences ADD COLUMN retest_reference_id TEXT;
