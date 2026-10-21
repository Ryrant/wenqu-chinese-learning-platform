-- 使改密后的旧会话可撤销。
ALTER TABLE `users` ADD `session_version` integer DEFAULT 0 NOT NULL;
