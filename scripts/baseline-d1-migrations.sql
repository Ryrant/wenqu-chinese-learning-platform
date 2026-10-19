-- 为早期由运行时幂等建表、但没有 Wrangler 迁移台账的 D1 数据库建立安全基线。
-- 每条记录只会在对应结构完整存在时写入；空数据库不会被误标记，仍会执行全部迁移。
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0000_dusty_mesmero.sql'
WHERE (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type='table' AND name IN (
    'ai_sessions','assignments','audit_logs','citations','classes','consent_records',
    'enrollments','feedback','guardian_student_links','knowledge_chunks','knowledge_entities',
    'learning_objectives','mastery_snapshots','role_memberships','source_documents',
    'submissions','tenants','users'
  )
)=18;

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0001_condemned_lester.sql'
WHERE (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type='table' AND name IN ('invitations','lesson_plans','notifications')
)=3;

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0002_pilot_school_readiness.sql'
WHERE (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type='table' AND name IN ('submission_reviews','assignment_objectives')
)=2
AND EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='password_hash')
AND EXISTS (SELECT 1 FROM pragma_table_info('users') WHERE name='must_change_password')
AND EXISTS (SELECT 1 FROM pragma_table_info('role_memberships') WHERE name='status')
AND EXISTS (SELECT 1 FROM pragma_table_info('guardian_student_links') WHERE name='status')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='reviewed_at');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0003_initial_setup_settings.sql'
WHERE EXISTS (
  SELECT 1 FROM sqlite_master WHERE type='table' AND name='app_settings'
);

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0004_learning_loop.sql'
WHERE (
  SELECT COUNT(*) FROM sqlite_master
  WHERE type='table' AND name IN (
    'diagnostic_items','diagnostic_attempts','diagnostic_answers',
    'learning_recommendations','submission_review_confirmations'
  )
)=5
AND EXISTS (SELECT 1 FROM pragma_table_info('learning_objectives') WHERE name='status')
AND EXISTS (SELECT 1 FROM pragma_table_info('assignments') WHERE name='rubric_json');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0005_ui_workflow.sql'
WHERE EXISTS (SELECT 1 FROM pragma_table_info('lesson_plans') WHERE name='updated_at')
AND EXISTS (SELECT 1 FROM pragma_table_info('lesson_plans') WHERE name='archived_at')
AND EXISTS (SELECT 1 FROM pragma_table_info('learning_recommendations') WHERE name='updated_at')
AND EXISTS (SELECT 1 FROM pragma_table_info('learning_recommendations') WHERE name='archived_at')
AND EXISTS (SELECT 1 FROM pragma_table_info('source_documents') WHERE name='updated_at')
AND EXISTS (SELECT 1 FROM pragma_table_info('source_documents') WHERE name='archived_at');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0006_learning_workflow_evidence.sql'
WHERE EXISTS (SELECT 1 FROM pragma_table_info('submission_reviews') WHERE name='objective_scores_json')
AND EXISTS (SELECT 1 FROM pragma_table_info('submission_reviews') WHERE name='dimension_scores_json')
AND EXISTS (SELECT 1 FROM pragma_table_info('learning_recommendations') WHERE name='assignment_id')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='family_task_id')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='family_help_level')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='family_confirmed_at')
AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='index' AND name='family_submission_pending_idx');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0007_ability_evidence.sql'
WHERE EXISTS (SELECT 1 FROM pragma_table_info('diagnostic_items') WHERE name='ability')
AND EXISTS (SELECT 1 FROM pragma_table_info('diagnostic_items') WHERE name='media_id')
AND EXISTS (SELECT 1 FROM pragma_table_info('diagnostic_items') WHERE name='revision')
AND EXISTS (SELECT 1 FROM pragma_table_info('diagnostic_answers') WHERE name='evidence_json')
AND EXISTS (SELECT 1 FROM pragma_table_info('assignments') WHERE name='diagnostic_mode')
AND EXISTS (SELECT 1 FROM pragma_table_info('assignments') WHERE name='diagnostic_prompt')
AND EXISTS (SELECT 1 FROM pragma_table_info('assignments') WHERE name='diagnostic_media_id')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='diagnostic_snapshot_json');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0008_family_exchange.sql'
WHERE EXISTS (SELECT 1 FROM pragma_table_info('learning_recommendations') WHERE name='family_plan_json')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='family_snapshot_json')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='family_confirmed_by')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='family_confirmation_role');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0009_learning_sequences.sql'
WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='learning_sequences')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='sequence_id')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='sequence_stage')
AND EXISTS (SELECT 1 FROM pragma_table_info('submissions') WHERE name='sequence_snapshot_json')
AND EXISTS (SELECT 1 FROM pragma_table_info('submission_reviews') WHERE name='evidence_json')
AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='index' AND name='sequence_submission_pending_idx');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0010_delayed_retest.sql'
WHERE EXISTS (SELECT 1 FROM pragma_table_info('learning_sequences') WHERE name='retest_prompt')
AND EXISTS (SELECT 1 FROM pragma_table_info('learning_sequences') WHERE name='retest_context')
AND EXISTS (SELECT 1 FROM pragma_table_info('learning_sequences') WHERE name='retest_available_at')
AND EXISTS (SELECT 1 FROM pragma_table_info('learning_sequences') WHERE name='retest_reference_id');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0011_teaching_next_steps.sql'
WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='learning_sequence_decisions')
AND (SELECT COUNT(*) FROM pragma_table_info('learning_sequence_decisions') WHERE name IN ('id','tenant_id','sequence_id','reference_submission_id','reference_snapshot_json','kind','rationale','remaining','next_sequence_id','created_by','created_at'))=11
AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='index' AND name='sequence_decision_reference_idx')
AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='index' AND name='sequence_decision_next_idx');

INSERT OR IGNORE INTO d1_migrations (name)
SELECT '0012_trial_records.sql'
WHERE (SELECT COUNT(*) FROM pragma_table_info('learning_trial_records') WHERE name IN ('id','tenant_id','sequence_id','kind','method','minutes','reference_submission_id','reference_title','note','created_by','created_at','voided_at','voided_by','void_reason'))=14
AND EXISTS (SELECT 1 FROM sqlite_master WHERE type='index' AND name='trial_records_sequence_idx');
