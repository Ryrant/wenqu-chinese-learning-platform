-- 将新机构的默认区域与运行时保持一致，完整保留既有机构数据。
-- 历史结构未定义引用 tenants 的外键，因此无需关闭 D1 的外键检查。
CREATE TABLE `__new_tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--> statement-breakpoint
INSERT INTO `__new_tenants`("id", "name", "region", "status", "created_at") SELECT "id", "name", "region", "status", "created_at" FROM `tenants`;
--> statement-breakpoint
DROP TABLE `tenants`;
--> statement-breakpoint
ALTER TABLE `__new_tenants` RENAME TO `tenants`;
