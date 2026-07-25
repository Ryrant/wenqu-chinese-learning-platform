CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invitations_tenant_idx` ON `invitations` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_idx` ON `invitations` (`token`);--> statement-breakpoint
CREATE TABLE `lesson_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`level` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`objectives_json` text DEFAULT '[]' NOT NULL,
	`activities_json` text DEFAULT '[]' NOT NULL,
	`citations_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lesson_plans_tenant_idx` ON `lesson_plans` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`kind` text DEFAULT 'info' NOT NULL,
	`read_at` text,
	`scheduled_for` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`tenant_id`,`user_id`,`created_at`);