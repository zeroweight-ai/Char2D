import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
const id = () => text("id").primaryKey();
const createdAt = () => integer("created_at").notNull();
const updatedAt = () => integer("updated_at").notNull();
export const characters = sqliteTable("characters", {
  id: id(), name: text("name").notNull(), description: text("description").notNull().default(""),
  viewType: text("view_type", { enum: ["side_scroller", "top_down", "three_quarter"] }).notNull(),
  status: text("status", { enum: ["draft", "generating", "ready", "error"] }).notNull().default("draft"),
  sourceAssetId: text("source_asset_id"), sheetId: text("sheet_id"), styleJson: text("style_json").notNull().default("{}"),
  paletteJson: text("palette_json").notNull().default("[]"), atlasAssetId: text("atlas_asset_id"), manifestJson: text("manifest_json"),
  atlasVersion: integer("atlas_version").notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(),
});
export const assets = sqliteTable("assets", {
  id: id(), characterId: text("character_id").references(() => characters.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), path: text("path").notNull(), mime: text("mime").notNull(),
  width: integer("width"), height: integer("height"), bytes: integer("bytes").notNull(), sha256: text("sha256").notNull(), createdAt: createdAt(),
});
export const characterSheets = sqliteTable("character_sheets", {
  id: id(), characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), rawAssetId: text("raw_asset_id").references(() => assets.id),
  processedAssetId: text("processed_asset_id").references(() => assets.id), viewsJson: text("views_json").notNull().default("{}"),
  anchorsJson: text("anchors_json").notNull().default("{}"), prompt: text("prompt").notNull(), status: text("status").notNull(), createdAt: createdAt(),
}, t => [uniqueIndex("sheet_version").on(t.characterId,t.version)]);
export const actions = sqliteTable("actions", {
  id: id(), characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  key: text("key").notNull(), label: text("label").notNull(), icon: text("icon"), isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  directionsJson: text("directions_json").notNull(), activeVersionId: text("active_version_id"), gameplayJson: text("gameplay_json").notNull().default("{}"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Set once default key bindings were assigned, so a key the player cleared stays cleared.
  bindingsSeeded: integer("bindings_seeded", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex("action_key").on(t.characterId,t.key)]);
export const actionVersions = sqliteTable("action_versions", {
  id: id(), actionId: text("action_id").notNull().references(() => actions.id, { onDelete: "cascade" }),
  version: integer("version").notNull(), parentVersionId: text("parent_version_id"), planJson: text("plan_json").notNull(),
  framesJson: text("frames_json").notNull().default("{}"), stripsJson: text("strips_json").notNull().default("{}"),
  status: text("status", { enum: ["queued", "generating", "processing", "ready", "error"] }).notNull(), error: text("error"),
  createdBy: text("created_by", { enum: ["default", "chat", "manual"] }).notNull(), chatMessageId: text("chat_message_id"), createdAt: createdAt(),
}, t => [uniqueIndex("action_version").on(t.actionId,t.version)]);
export const inputBindings = sqliteTable("input_bindings", {
  id: id(), characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  profile: text("profile", { enum: ["p1", "p2"] }).notNull(), actionId: text("action_id").notNull().references(() => actions.id, { onDelete: "cascade" }),
  device: text("device", { enum: ["keyboard", "gamepad"] }).notNull(), code: text("code").notNull(), trigger: text("trigger", { enum: ["press", "hold", "toggle"] }).notNull(),
}, t => [uniqueIndex("binding_code").on(t.characterId,t.profile,t.device,t.code)]);
export const chatMessages = sqliteTable("chat_messages", {
  id: id(), characterId: text("character_id").notNull().references(() => characters.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant", "tool"] }).notNull(), content: text("content").notNull(),
  toolCallsJson: text("tool_calls_json"), attachmentsJson: text("attachments_json"), createdAt: createdAt(),
});
export const jobs = sqliteTable("jobs", {
  id: id(), type: text("type", { enum: ["demo", "sheet", "strip", "process_action", "compose_atlas", "export"] }).notNull(),
  characterId: text("character_id").references(() => characters.id, { onDelete: "cascade" }),
  actionVersionId: text("action_version_id").references(() => actionVersions.id, { onDelete: "cascade" }), payloadJson: text("payload_json").notNull().default("{}"),
  status: text("status", { enum: ["queued", "running", "done", "error", "cancelled"] }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(3), runAfter: integer("run_after").notNull(),
  lockedBy: text("locked_by"), lockedAt: integer("locked_at"), dependsOnJson: text("depends_on_json").notNull().default("[]"),
  error: text("error"), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index("job_poll").on(t.status,t.runAfter)]);
export const jobEvents = sqliteTable("job_events", {
  id: integer("id").primaryKey({ autoIncrement: true }), jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  characterId: text("character_id"), kind: text("kind").notNull(), dataJson: text("data_json").notNull(), createdAt: createdAt(),
}, t => [index("event_character").on(t.characterId,t.id)]);
export const aiCalls = sqliteTable("ai_calls", {
  id: id(), kind: text("kind", { enum: ["chat", "image"] }).notNull(), model: text("model").notNull(), requestHash: text("request_hash").notNull(),
  latencyMs: integer("latency_ms").notNull(), usageJson: text("usage_json"), ok: integer("ok", { mode: "boolean" }).notNull(),
  error: text("error"), createdAt: createdAt(),
});
export const playgroundScenes = sqliteTable("playground_scenes", {
  id: id(), world: text("world", { enum: ["side_scroller", "top_down"] }).notNull(), name: text("name").notNull(), charactersJson: text("characters_json").notNull(), createdAt: createdAt(),
});
// Active sheet/version/atlas pointers are intentionally application-managed to avoid
// circular creation dependencies. Ownership must be checked by future repositories.
