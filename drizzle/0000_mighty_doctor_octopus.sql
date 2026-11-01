CREATE TABLE `action_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`action_id` text NOT NULL,
	`version` integer NOT NULL,
	`parent_version_id` text,
	`plan_json` text NOT NULL,
	`frames_json` text DEFAULT '{}' NOT NULL,
	`strips_json` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_by` text NOT NULL,
	`chat_message_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`action_id`) REFERENCES `actions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_version` ON `action_versions` (`action_id`,`version`);--> statement-breakpoint
CREATE TABLE `actions` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`icon` text,
	`is_default` integer DEFAULT false NOT NULL,
	`directions_json` text NOT NULL,
	`active_version_id` text,
	`gameplay_json` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `action_key` ON `actions` (`character_id`,`key`);--> statement-breakpoint
CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`model` text NOT NULL,
	`request_hash` text NOT NULL,
	`latency_ms` integer NOT NULL,
	`usage_json` text,
	`ok` integer NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `character_sheets` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`version` integer NOT NULL,
	`raw_asset_id` text,
	`processed_asset_id` text,
	`views_json` text DEFAULT '{}' NOT NULL,
	`anchors_json` text DEFAULT '{}' NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`raw_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`processed_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sheet_version` ON `character_sheets` (`character_id`,`version`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`view_type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`source_asset_id` text,
	`sheet_id` text,
	`style_json` text DEFAULT '{}' NOT NULL,
	`palette_json` text DEFAULT '[]' NOT NULL,
	`atlas_asset_id` text,
	`manifest_json` text,
	`atlas_version` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls_json` text,
	`attachments_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `input_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`profile` text NOT NULL,
	`action_id` text NOT NULL,
	`device` text NOT NULL,
	`code` text NOT NULL,
	`trigger` text NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`action_id`) REFERENCES `actions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `binding_code` ON `input_bindings` (`character_id`,`profile`,`device`,`code`);--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`character_id` text,
	`kind` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_character` ON `job_events` (`character_id`,`id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`character_id` text,
	`action_version_id` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer NOT NULL,
	`locked_by` text,
	`locked_at` integer,
	`depends_on_json` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`action_version_id`) REFERENCES `action_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_poll` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `playground_scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`world` text NOT NULL,
	`name` text NOT NULL,
	`characters_json` text NOT NULL,
	`created_at` integer NOT NULL
);
