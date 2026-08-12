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
