ALTER TABLE learning_recommendations ADD COLUMN family_plan_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE submissions ADD COLUMN family_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE submissions ADD COLUMN family_confirmed_by TEXT;
ALTER TABLE submissions ADD COLUMN family_confirmation_role TEXT;
