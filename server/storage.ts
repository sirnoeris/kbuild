import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, like, or, and, ne } from "drizzle-orm";
import * as schema from "@shared/schema";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "kb.db");
const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite, { schema });

// ─── Migrations (inline) ─────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS vault_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_path TEXT NOT NULL DEFAULT '',
    auto_scan INTEGER NOT NULL DEFAULT 1,
    max_concurrent INTEGER NOT NULL DEFAULT 2,
    max_retries INTEGER NOT NULL DEFAULT 3,
    enabled_formats TEXT NOT NULL DEFAULT '["pdf","html","docx","pptx","xlsx","csv","md","txt"]',
    processing_connection_id INTEGER,
    processing_model TEXT,
    chat_connection_id INTEGER,
    chat_model TEXT,
    last_scan_at TEXT,
    last_run_summary TEXT
  );

  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'openai_compatible',
    models_endpoint TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'other',
    hash TEXT,
    size INTEGER,
    mtime TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    wiki_path TEXT,
    processed_at TEXT,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    title TEXT,
    tags TEXT,
    summary TEXT
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New conversation',
    pinned_files TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    context_files TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wiki_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'source',
    tags TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    source_file TEXT,
    last_updated TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- FTS virtual table for wiki
  CREATE VIRTUAL TABLE IF NOT EXISTS wiki_fts USING fts5(
    path UNINDEXED,
    title,
    summary,
    body,
    content='wiki_pages',
    content_rowid='id'
  );

  -- Seed default vault settings row if none
  INSERT OR IGNORE INTO vault_settings (id) VALUES (1);
`);

export interface IStorage {
  // Vault
  getVaultSettings(): schema.VaultSettings;
  updateVaultSettings(data: Partial<schema.InsertVaultSettings>): schema.VaultSettings;

  // Connections
  getConnections(): schema.Connection[];
  getConnection(id: number): schema.Connection | undefined;
  createConnection(data: schema.InsertConnection): schema.Connection;
  updateConnection(id: number, data: Partial<schema.InsertConnection>): schema.Connection | undefined;
  deleteConnection(id: number): void;

  // Files
  getFiles(): schema.KBFile[];
  getFile(id: number): schema.KBFile | undefined;
  getFileByPath(path: string): schema.KBFile | undefined;
  createFile(data: schema.InsertFile): schema.KBFile;
  updateFile(id: number, data: Partial<schema.InsertFile>): schema.KBFile | undefined;
  deleteFile(id: number): void;
  clearAllFiles(): void;

  // Conversations
  getConversations(): schema.Conversation[];
  getConversation(id: number): schema.Conversation | undefined;
  createConversation(data: schema.InsertConversation): schema.Conversation;
  updateConversation(id: number, data: Partial<schema.InsertConversation>): schema.Conversation | undefined;
  deleteConversation(id: number): void;

  // Messages
  getMessages(conversationId: number): schema.Message[];
  createMessage(data: schema.InsertMessage): schema.Message;

  // Wiki pages
  getWikiPages(): schema.WikiPage[];
  getWikiPage(id: number): schema.WikiPage | undefined;
  getWikiPageByPath(path: string): schema.WikiPage | undefined;
  upsertWikiPage(data: schema.InsertWikiPage): schema.WikiPage;
  deleteWikiPageByPath(path: string): void;
  searchWikiPages(query: string, limit?: number): schema.WikiPage[];
  clearWikiPages(): void;
}

export class Storage implements IStorage {
  getVaultSettings() {
    let row = db.select().from(schema.vaultSettings).where(eq(schema.vaultSettings.id, 1)).get();
    if (!row) {
      db.insert(schema.vaultSettings).values({ id: 1 } as any).run();
      row = db.select().from(schema.vaultSettings).where(eq(schema.vaultSettings.id, 1)).get()!;
    }
    return row;
  }

  updateVaultSettings(data: Partial<schema.InsertVaultSettings>) {
    db.update(schema.vaultSettings).set(data as any).where(eq(schema.vaultSettings.id, 1)).run();
    return this.getVaultSettings();
  }

  getConnections() {
    return db.select().from(schema.connections).all();
  }

  getConnection(id: number) {
    return db.select().from(schema.connections).where(eq(schema.connections.id, id)).get();
  }

  createConnection(data: schema.InsertConnection) {
    return db.insert(schema.connections).values(data).returning().get();
  }

  updateConnection(id: number, data: Partial<schema.InsertConnection>) {
    db.update(schema.connections).set(data as any).where(eq(schema.connections.id, id)).run();
    return this.getConnection(id);
  }

  deleteConnection(id: number) {
    db.delete(schema.connections).where(eq(schema.connections.id, id)).run();
  }

  getFiles() {
    return db.select().from(schema.files).orderBy(desc(schema.files.addedAt)).all();
  }

  getFile(id: number) {
    return db.select().from(schema.files).where(eq(schema.files.id, id)).get();
  }

  getFileByPath(filePath: string) {
    return db.select().from(schema.files).where(eq(schema.files.path, filePath)).get();
  }

  createFile(data: schema.InsertFile) {
    return db.insert(schema.files).values(data).returning().get();
  }

  updateFile(id: number, data: Partial<schema.InsertFile>) {
    db.update(schema.files).set(data as any).where(eq(schema.files.id, id)).run();
    return this.getFile(id);
  }

  deleteFile(id: number) {
    db.delete(schema.files).where(eq(schema.files.id, id)).run();
  }

  clearAllFiles() {
    db.delete(schema.files).run();
  }

  getConversations() {
    return db.select().from(schema.conversations).orderBy(desc(schema.conversations.updatedAt)).all();
  }

  getConversation(id: number) {
    return db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get();
  }

  createConversation(data: schema.InsertConversation) {
    return db.insert(schema.conversations).values(data).returning().get();
  }

  updateConversation(id: number, data: Partial<schema.InsertConversation>) {
    db.update(schema.conversations).set({ ...data as any, updatedAt: new Date().toISOString() }).where(eq(schema.conversations.id, id)).run();
    return this.getConversation(id);
  }

  deleteConversation(id: number) {
    db.delete(schema.conversations).where(eq(schema.conversations.id, id)).run();
    db.delete(schema.messages).where(eq(schema.messages.conversationId, id)).run();
  }

  getMessages(conversationId: number) {
    return db.select().from(schema.messages).where(eq(schema.messages.conversationId, conversationId)).all();
  }

  createMessage(data: schema.InsertMessage) {
    return db.insert(schema.messages).values(data).returning().get();
  }

  getWikiPages() {
    return db.select().from(schema.wikiPages).all();
  }

  getWikiPage(id: number) {
    return db.select().from(schema.wikiPages).where(eq(schema.wikiPages.id, id)).get();
  }

  getWikiPageByPath(path: string) {
    return db.select().from(schema.wikiPages).where(eq(schema.wikiPages.path, path)).get();
  }

  upsertWikiPage(data: schema.InsertWikiPage): schema.WikiPage {
    const existing = this.getWikiPageByPath(data.path);
    if (existing) {
      db.update(schema.wikiPages).set(data as any).where(eq(schema.wikiPages.path, data.path)).run();
      const updated = this.getWikiPageByPath(data.path)!;
      // Update FTS
      sqlite.prepare("DELETE FROM wiki_fts WHERE rowid = ?").run(updated.id);
      sqlite.prepare("INSERT INTO wiki_fts(rowid, path, title, summary, body) VALUES (?,?,?,?,?)").run(
        updated.id, updated.path, updated.title, updated.summary, updated.body
      );
      return updated;
    } else {
      const row = db.insert(schema.wikiPages).values(data).returning().get();
      sqlite.prepare("INSERT OR IGNORE INTO wiki_fts(rowid, path, title, summary, body) VALUES (?,?,?,?,?)").run(
        row.id, row.path, row.title, row.summary, row.body
      );
      return row;
    }
  }

  searchWikiPages(query: string, limit = 10): schema.WikiPage[] {
    if (!query.trim()) return this.getWikiPages().slice(0, limit);

    // Sanitise query for FTS5: strip punctuation/special chars, split into
    // individual keywords, prefix-match each one. This handles natural language
    // questions like "What's in my wiki?" without breaking the FTS5 parser.
    const keywords = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")   // strip punctuation incl apostrophes
      .split(/\s+/)
      .filter(w => w.length > 2)  // skip stop words / very short tokens
      .slice(0, 8);               // cap at 8 keywords

    // Try FTS5 with sanitised keywords
    if (keywords.length > 0) {
      const ftsQuery = keywords.map(k => `"${k}"*`).join(" OR ");
      try {
        const rows = sqlite.prepare(
          `SELECT wp.* FROM wiki_pages wp
           INNER JOIN wiki_fts ON wiki_fts.rowid = wp.id
           WHERE wiki_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        ).all(ftsQuery, limit) as schema.WikiPage[];
        if (rows.length > 0) return rows;
      } catch {
        // fall through to LIKE
      }
    }

    // Fallback 1: LIKE search on title + summary (fast columns)
    const likeResults = db.select().from(schema.wikiPages)
      .where(or(
        like(schema.wikiPages.title, `%${keywords.join("%") || query}%`),
        like(schema.wikiPages.summary, `%${keywords[0] || query}%`)
      ))
      .limit(limit).all();
    if (likeResults.length > 0) return likeResults;

    // Fallback 2: return most-recently-updated pages so chat always has context
    return db.select().from(schema.wikiPages)
      .orderBy(desc(schema.wikiPages.lastUpdated))
      .limit(limit).all();
  }

  deleteWikiPageByPath(wikiPath: string) {
    const page = this.getWikiPageByPath(wikiPath);
    if (page) {
      sqlite.prepare("DELETE FROM wiki_fts WHERE rowid = ?").run(page.id);
      db.delete(schema.wikiPages).where(eq(schema.wikiPages.path, wikiPath)).run();
    }
  }

  clearWikiPages() {
    db.delete(schema.wikiPages).run();
    sqlite.prepare("DELETE FROM wiki_fts").run();
  }
}

export const storage = new Storage();
