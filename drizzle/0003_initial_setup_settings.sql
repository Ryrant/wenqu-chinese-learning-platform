CREATE TABLE `app_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
