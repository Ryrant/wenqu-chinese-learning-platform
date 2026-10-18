ALTER TABLE `diagnostic_items` ADD COLUMN `ability` text NOT NULL DEFAULT 'reading';--> statement-breakpoint
ALTER TABLE `diagnostic_items` ADD COLUMN `media_id` text;--> statement-breakpoint
ALTER TABLE `diagnostic_items` ADD COLUMN `revision` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `diagnostic_answers` ADD COLUMN `evidence_json` text NOT NULL DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `assignments` ADD COLUMN `diagnostic_mode` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `assignments` ADD COLUMN `diagnostic_prompt` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `assignments` ADD COLUMN `diagnostic_media_id` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD COLUMN `diagnostic_snapshot_json` text NOT NULL DEFAULT '{}';
