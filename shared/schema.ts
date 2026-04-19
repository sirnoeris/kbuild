import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Vault ─────────────────────────────────────────────────────────────────
export const vaultSettings = sqliteTable("vault_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vaultPath: text("vault_path").notNull().default(""),
  autoScan: integer("auto_scan", { mode: "boolean" }).notNull().default(true),
  maxConcurrent: integer("max_concurrent").notNull().default(2),
  maxRetries: integer("max_retries").notNull().default(3),
  enabledFormats: text("enabled_formats").notNull().default('["pdf","html","docx","pptx","xlsx","csv","md","txt"]'),
  processingConnectionId: integer("processing_connection_id"),
  processingModel: text("processing_model"),
  chatConnectionId: integer("chat_connection_id"),
  chatModel: text("chat_model"),
  lastScanAt: text("last_scan_at"),
  lastRunSummary: text("last_run_summary"), // JSON: { processedCount, errorCount, timestamp }
});

export const insertVaultSettingsSchema = createInsertSchema(vaultSettings).omit({ id: true });
export type InsertVaultSettings = z.infer<typeof insertVaultSettingsSchema>;
export type VaultSettings = typeof vaultSettings.$inferSelect;

// ─── LLM Connections ────────────────────────────────────────────────────────
export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKey: text("api_key").notNull().default(""),
  type: text("type").notNull().default("openai_compatible"), // openai_compatible | xai | custom_local
  modelsEndpoint: text("models_endpoint"), // optional override path for listing models
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertConnectionSchema = createInsertSchema(connections).omit({ id: true, createdAt: true });
export type InsertConnection = z.infer<typeof insertConnectionSchema>;
export type Connection = typeof connections.$inferSelect;

// ─── File Registry ──────────────────────────────────────────────────────────
export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(), // relative to vault root, within raw/
  kind: text("kind").notNull().default("other"), // pdf|html|docx|pptx|xlsx|csv|md|txt|other
  hash: text("hash"),
  size: integer("size"),
  mtime: text("mtime"),
  status: text("status").notNull().default("pending"), // pending|processing|done|error
  errorMessage: text("error_message"),
  wikiPath: text("wiki_path"), // relative path to generated wiki/sources/<slug>.md
  processedAt: text("processed_at"),
  addedAt: text("added_at").notNull().default(new Date().toISOString()),
  title: text("title"),
  tags: text("tags"), // JSON array
  summary: text("summary"),
});

export const insertFileSchema = createInsertSchema(files).omit({ id: true, addedAt: true });
export type InsertFile = z.infer<typeof insertFileSchema>;
export type KBFile = typeof files.$inferSelect;

// ─── Conversations ───────────────────────────────────────────────────────────
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("New conversation"),
  pinnedFiles: text("pinned_files").notNull().default("[]"), // JSON array of wiki paths
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

// ─── Messages ────────────────────────────────────────────────────────────────
export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  contextFiles: text("context_files"), // JSON array of wiki paths used for this answer
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messages.$inferSelect;

// ─── Wiki Pages (cached index for FTS) ──────────────────────────────────────
export const wikiPages = sqliteTable("wiki_pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(), // relative to vault root
  title: text("title").notNull().default(""),
  type: text("type").notNull().default("source"), // source | topic
  tags: text("tags").notNull().default("[]"),
  summary: text("summary").notNull().default(""),
  body: text("body").notNull().default(""),
  sourceFile: text("source_file"), // path in raw/ if type=source
  lastUpdated: text("last_updated").notNull().default(new Date().toISOString()),
});

export const insertWikiPageSchema = createInsertSchema(wikiPages).omit({ id: true });
export type InsertWikiPage = z.infer<typeof insertWikiPageSchema>;
export type WikiPage = typeof wikiPages.$inferSelect;
