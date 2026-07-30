ALTER TABLE `users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `users` ADD `status` text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;--> statement-breakpoint
ALTER TABLE `role_memberships` ADD `status` text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `guardian_student_links` ADD `status` text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `source_documents` ADD `processing_error` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `feedback` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `reviewed_at` text;--> statement-breakpoint
CREATE TABLE `submission_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `submission_id` text NOT NULL,
  `reviewer_user_id` text NOT NULL,
  `final_score` real,
  `final_comment` text,
  `ai_suggested_score` real,
  `ai_comment` text,
  `weakness_tags_json` text DEFAULT '[]' NOT NULL,
  `status` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `submission_reviews_tenant_idx` ON `submission_reviews` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `submission_reviews_submission_idx` ON `submission_reviews` (`tenant_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `assignment_objectives` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `tenant_id` text NOT NULL,
  `assignment_id` text NOT NULL,
  `objective_id` text NOT NULL,
  `weight` real DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assignment_objectives_assignment_idx` ON `assignment_objectives` (`tenant_id`,`assignment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_objective_unique_idx` ON `assignment_objectives` (`tenant_id`,`assignment_id`,`objective_id`);
