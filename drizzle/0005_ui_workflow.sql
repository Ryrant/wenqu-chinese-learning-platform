ALTER TABLE `lesson_plans` ADD COLUMN `updated_at` text;--> statement-breakpoint
ALTER TABLE `lesson_plans` ADD COLUMN `archived_at` text;--> statement-breakpoint
UPDATE `lesson_plans` SET `updated_at`=`created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
ALTER TABLE `learning_recommendations` ADD COLUMN `updated_at` text;--> statement-breakpoint
ALTER TABLE `learning_recommendations` ADD COLUMN `archived_at` text;--> statement-breakpoint
UPDATE `learning_recommendations` SET `updated_at`=`created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
ALTER TABLE `source_documents` ADD COLUMN `updated_at` text;--> statement-breakpoint
ALTER TABLE `source_documents` ADD COLUMN `archived_at` text;--> statement-breakpoint
UPDATE `source_documents` SET `updated_at`=`created_at` WHERE `updated_at` IS NULL;
