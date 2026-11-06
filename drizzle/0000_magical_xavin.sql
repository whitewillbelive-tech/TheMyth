CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT "chapters_record_json" CHECK(json_valid("chapters"."record"))
);
--> statement-breakpoint
CREATE INDEX `chapter_document` ON `chapters` ("record" ->> '$.document_id');--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT "documents_record_json" CHECK(json_valid("documents"."record"))
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT "entities_record_json" CHECK(json_valid("entities"."record"))
);
--> statement-breakpoint
CREATE INDEX `entity_kind` ON `entities` ("record" ->> '$.kind');--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT "groups_record_json" CHECK(json_valid("groups"."record"))
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT "memberships_record_json" CHECK(json_valid("memberships"."record"))
);
--> statement-breakpoint
CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relations` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT "relations_record_json" CHECK(json_valid("relations"."record"))
);
--> statement-breakpoint
CREATE INDEX `relation_source` ON `relations` ("record" ->> '$.source_id');--> statement-breakpoint
CREATE INDEX `relation_target` ON `relations` ("record" ->> '$.target_id');--> statement-breakpoint
CREATE TABLE `schema_migrations` (
	`version` integer PRIMARY KEY NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `states` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT "states_record_json" CHECK(json_valid("states"."record"))
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	CONSTRAINT "versions_record_json" CHECK(json_valid("versions"."record"))
);
