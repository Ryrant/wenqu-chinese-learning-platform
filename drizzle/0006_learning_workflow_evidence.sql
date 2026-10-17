ALTER TABLE `submission_reviews` ADD COLUMN `objective_scores_json` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `submission_reviews` ADD COLUMN `dimension_scores_json` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `learning_recommendations` ADD COLUMN `assignment_id` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD COLUMN `family_task_id` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD COLUMN `family_help_level` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD COLUMN `family_confirmed_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `family_submission_pending_idx` ON `submissions` (`tenant_id`,`family_task_id`) WHERE `family_task_id` IS NOT NULL AND `review_status`!='reviewed';
