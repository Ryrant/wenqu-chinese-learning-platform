ALTER TABLE `learning_objectives` ADD `status` text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `assignments` ADD `rubric_json` text NOT NULL DEFAULT '[]';--> statement-breakpoint
UPDATE `assignments` SET `rubric_json`='[{"name":"内容准确性","weight":40},{"name":"语言表达","weight":35},{"name":"文化理解","weight":25}]' WHERE `rubric_json`='[]';--> statement-breakpoint
CREATE TABLE `diagnostic_items` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `objective_id` text NOT NULL,
  `level` text NOT NULL,
  `prompt` text NOT NULL,
  `options_json` text NOT NULL,
  `correct_option` integer NOT NULL,
  `explanation` text DEFAULT '' NOT NULL,
  `sort_order` integer DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_by` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `diagnostic_items_tenant_idx` ON `diagnostic_items` (`tenant_id`,`level`,`status`);--> statement-breakpoint
CREATE INDEX `diagnostic_items_objective_idx` ON `diagnostic_items` (`tenant_id`,`objective_id`);--> statement-breakpoint
CREATE TABLE `diagnostic_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `student_user_id` text NOT NULL,
  `level` text NOT NULL,
  `score` real NOT NULL,
  `status` text DEFAULT 'completed' NOT NULL,
  `completed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `diagnostic_attempts_student_idx` ON `diagnostic_attempts` (`tenant_id`,`student_user_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `diagnostic_answers` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `item_id` text NOT NULL,
  `selected_option` integer NOT NULL,
  `is_correct` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `diagnostic_answers_attempt_idx` ON `diagnostic_answers` (`tenant_id`,`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_answer_unique_idx` ON `diagnostic_answers` (`tenant_id`,`attempt_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `learning_recommendations` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `student_user_id` text NOT NULL,
  `objective_id` text,
  `source_type` text NOT NULL,
  `source_id` text,
  `title` text NOT NULL,
  `detail` text DEFAULT '' NOT NULL,
  `due_at` text,
  `status` text DEFAULT 'pending' NOT NULL,
  `created_by` text NOT NULL,
  `completed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE INDEX `learning_recommendations_student_idx` ON `learning_recommendations` (`tenant_id`,`student_user_id`,`status`,`due_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_recommendation_source_idx` ON `learning_recommendations` (`tenant_id`,`student_user_id`,`source_type`,`source_id`);
--> statement-breakpoint
CREATE TABLE `submission_review_confirmations` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `submission_id` text NOT NULL,
  `reviewer_user_id` text NOT NULL,
  `score` real NOT NULL,
  `comment` text DEFAULT '' NOT NULL,
  `confirmed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submission_review_confirmation_unique_idx` ON `submission_review_confirmations` (`tenant_id`,`submission_id`);
