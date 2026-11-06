import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Preserve the original SQLite collection boundaries and extensible JSON payloads.
// Runtime data and original backup contents never belong in schema migrations.
export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
}, (table) => [
  check("entities_record_json", sql`json_valid(${table.record})`),
  // ->> is equivalent to json_extract for these scalar paths and avoids
  // drizzle-kit 0.31's comma splitting in SQLite expression indexes.
  index("entity_kind").on(sql`${table.record} ->> '$.kind'`),
]);

export const relations = sqliteTable("relations", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
}, (table) => [
  check("relations_record_json", sql`json_valid(${table.record})`),
  index("relation_source").on(sql`${table.record} ->> '$.source_id'`),
  index("relation_target").on(sql`${table.record} ->> '$.target_id'`),
]);

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
}, (table) => [check("groups_record_json", sql`json_valid(${table.record})`)]);

export const memberships = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
}, (table) => [check("memberships_record_json", sql`json_valid(${table.record})`)]);

export const states = sqliteTable("states", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
}, (table) => [check("states_record_json", sql`json_valid(${table.record})`)]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
}, (table) => [check("documents_record_json", sql`json_valid(${table.record})`)]);

export const chapters = sqliteTable("chapters", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
}, (table) => [
  check("chapters_record_json", sql`json_valid(${table.record})`),
  index("chapter_document").on(sql`${table.record} ->> '$.document_id'`),
]);

export const versions = sqliteTable("versions", {
  id: text("id").primaryKey(),
  record: text("record").notNull(),
}, (table) => [check("versions_record_json", sql`json_valid(${table.record})`)]);

// Also carries the Sites adapter's global compare-and-swap revision. The NOT NULL
// constraint is intentionally preserved: failed CAS checks abort the whole batch.
export const metadata = sqliteTable("metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const schemaMigrations = sqliteTable("schema_migrations", {
  version: integer("version").primaryKey(),
  appliedAt: text("applied_at").notNull(),
});
