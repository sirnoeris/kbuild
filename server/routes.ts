import type { Express, Request, Response } from "express";
import type { Server } from "http";
import fs from "fs";
import path from "path";
import { storage } from "./storage.js";
import { listModels } from "./llm-client.js";
import { scanRawFolder, processPendingFiles, chatOverWiki, chatDirect, getIsProcessing, ingestionEvents, syncWikiToDb, performWebSearch, synthesiseWebAnswer, DEFAULT_CHAT_SYSTEM_BASE } from "./ingestion.js";
import { insertConnectionSchema } from "../shared/schema.js";

export function registerRoutes(httpServer: Server, app: Express) {

  // ─── Vault ───────────────────────────────────────────────────────────────
  app.get("/api/vault", (_req, res) => {
    res.json(storage.getVaultSettings());
  });

  app.patch("/api/vault", (req, res) => {
    try {
      const updated = storage.updateVaultSettings(req.body);
      // If vault path changed, create folder structure
      if (req.body.vaultPath) {
        const vp = req.body.vaultPath;
        for (const dir of ["raw", "wiki", "wiki/sources", "wiki/topics", "outputs", ".kb-meta"]) {
          fs.mkdirSync(path.join(vp, dir), { recursive: true });
        }
      }
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // System prompt — get/set custom chat system prompt (vault is a singleton; vaultId is accepted but not used)
  app.get("/api/vault/:vaultId/system-prompt", (_req, res) => {
    const settings = storage.getVaultSettings();
    const custom = settings.customSystemPrompt;
    const isCustom = !!(custom && custom.trim());
    res.json({
      prompt: isCustom ? custom : DEFAULT_CHAT_SYSTEM_BASE,
      isCustom,
    });
  });

  app.put("/api/vault/:vaultId/system-prompt", (req, res) => {
    try {
      const { prompt } = req.body as { prompt: string | null };
      const value = prompt && prompt.trim() ? prompt : null;
      storage.updateVaultSettings({ customSystemPrompt: value } as any);
      const isCustom = !!value;
      res.json({
        prompt: isCustom ? value : DEFAULT_CHAT_SYSTEM_BASE,
        isCustom,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Choose vault — validate it exists and create structure
  app.post("/api/vault/choose", (req, res) => {
    const { vaultPath } = req.body;
    if (!vaultPath) return res.status(400).json({ error: "vaultPath required" });
    try {
      if (!fs.existsSync(vaultPath)) {
        fs.mkdirSync(vaultPath, { recursive: true });
      }
      for (const dir of ["raw", "wiki", "wiki/sources", "wiki/topics", "outputs", ".kb-meta"]) {
        fs.mkdirSync(path.join(vaultPath, dir), { recursive: true });
      }
      const updated = storage.updateVaultSettings({ vaultPath });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Connections ─────────────────────────────────────────────────────────
  // Mask API keys — return only the first 8 chars + asterisks so the UI can
  // show a preview without ever exposing the full secret over the wire.
  function maskConnections(conns: ReturnType<typeof storage.getConnections>) {
    return conns.map(c => ({
      ...c,
      apiKey: c.apiKey
        ? c.apiKey.slice(0, 8) + "•".repeat(Math.max(0, c.apiKey.length - 8))
        : "",
    }));
  }

  app.get("/api/connections", (_req, res) => {
    res.json(maskConnections(storage.getConnections()));
  });

  app.post("/api/connections", (req, res) => {
    try {
      const data = insertConnectionSchema.parse(req.body);
      const conn = storage.createConnection(data);
      res.json({ ...conn, apiKey: conn.apiKey ? conn.apiKey.slice(0, 8) + "•".repeat(Math.max(0, conn.apiKey.length - 8)) : "" });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch("/api/connections/:id", (req, res) => {
    const id = parseInt(req.params.id);
    // If the client sends back a masked key (all bullets), don't overwrite the real key
    const body = { ...req.body };
    if (body.apiKey && /^[^•]*•+$/.test(body.apiKey)) {
      delete body.apiKey; // keep existing key in DB
    }
    const updated = storage.updateConnection(id, body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json({ ...updated, apiKey: updated.apiKey ? updated.apiKey.slice(0, 8) + "•".repeat(Math.max(0, updated.apiKey.length - 8)) : "" });
  });

  app.delete("/api/connections/:id", (req, res) => {
    storage.deleteConnection(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // Test a connection + list its models
  app.post("/api/connections/:id/test", async (req, res) => {
    try {
      const models = await listModels(parseInt(req.params.id));
      res.json({ ok: true, models });
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get("/api/connections/:id/models", async (req, res) => {
    try {
      const models = await listModels(parseInt(req.params.id));
      res.json(models);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ─── Files ───────────────────────────────────────────────────────────────
  app.get("/api/files", (_req, res) => {
    res.json(storage.getFiles());
  });

  app.post("/api/files/scan", async (req, res) => {
    const settings = storage.getVaultSettings();
    if (!settings.vaultPath) return res.status(400).json({ error: "No vault path set" });
    try {
      const result = await scanRawFolder(settings.vaultPath);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/files/process", async (req, res) => {
    const settings = storage.getVaultSettings();
    if (!settings.vaultPath) return res.status(400).json({ error: "No vault path set" });
    if (getIsProcessing()) return res.status(409).json({ error: "Processing already in progress" });
    try {
      // Don't await — let it run and stream via SSE
      processPendingFiles(settings.vaultPath).catch(console.error);
      res.json({ ok: true, message: "Processing started" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/files/:id/retry", async (req, res) => {
    const file = storage.getFile(parseInt(req.params.id));
    if (!file) return res.status(404).json({ error: "Not found" });
    storage.updateFile(file.id, { status: "pending", errorMessage: null });
    res.json({ ok: true });
  });

  // Reprocess a single file — reset to pending and delete its wiki page from disk + DB
  // so the next processing run regenerates it cleanly.
  app.post("/api/files/:id/reprocess", async (req, res) => {
    const file = storage.getFile(parseInt(req.params.id));
    if (!file) return res.status(404).json({ error: "Not found" });
    const settings = storage.getVaultSettings();
    // Delete the existing wiki page from disk if it exists
    if (file.wikiPath && settings.vaultPath) {
      const absWikiPath = path.join(settings.vaultPath, file.wikiPath);
      try { if (fs.existsSync(absWikiPath)) fs.unlinkSync(absWikiPath); } catch {}
    }
    // Remove from DB wiki index
    if (file.wikiPath) storage.deleteWikiPageByPath(file.wikiPath);
    // Reset file to pending
    storage.updateFile(file.id, { status: "pending", errorMessage: null, wikiPath: null, title: null, summary: null, processedAt: null });
    res.json({ ok: true });
  });

  app.delete("/api/files/:id", (req, res) => {
    storage.deleteFile(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // Reset all files to pending (for retry-all-errors)
  app.post("/api/files/reset-all", (_req, res) => {
    const files = storage.getFiles();
    for (const f of files) storage.updateFile(f.id, { status: "pending", errorMessage: null });
    res.json({ ok: true });
  });

  // Reprocess all files — reset every file to pending and clear all wiki pages
  app.post("/api/files/reprocess-all", (req, res) => {
    const settings = storage.getVaultSettings();
    const files = storage.getFiles();
    for (const f of files) {
      if (f.wikiPath && settings.vaultPath) {
        const absWikiPath = path.join(settings.vaultPath, f.wikiPath);
        try { if (fs.existsSync(absWikiPath)) fs.unlinkSync(absWikiPath); } catch {}
      }
      storage.updateFile(f.id, { status: "pending", errorMessage: null, wikiPath: null, title: null, summary: null, processedAt: null });
    }
    storage.clearWikiPages();
    res.json({ ok: true, count: files.length });
  });

  // ─── SSE Progress stream ──────────────────────────────────────────────────
  app.get("/api/events", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const listener = (payload: unknown) => send(payload);
    ingestionEvents.on("progress", listener);

    // Heartbeat
    const hb = setInterval(() => res.write(": heartbeat\n\n"), 15_000);

    req.on("close", () => {
      ingestionEvents.off("progress", listener);
      clearInterval(hb);
    });
  });

  // ─── Wiki pages ───────────────────────────────────────────────────────────
  app.get("/api/wiki", (_req, res) => {
    res.json(storage.getWikiPages());
  });

  app.get("/api/wiki/search", (req, res) => {
    const q = (req.query.q as string) ?? "";
    const limit = parseInt((req.query.limit as string) ?? "10");
    res.json(storage.searchWikiPages(q, limit));
  });

  app.get("/api/wiki/page", (req, res) => {
    const p = req.query.path as string;
    if (!p) return res.status(400).json({ error: "path required" });
    const page = storage.getWikiPageByPath(p);
    if (!page) return res.status(404).json({ error: "Not found" });

    // Also try to read the actual file content from disk.
    // Guard against path traversal: resolved path must stay inside vaultPath.
    const settings = storage.getVaultSettings();
    let rawContent = page.body;
    if (settings.vaultPath) {
      const absPath = path.resolve(settings.vaultPath, p);
      const vaultAbs = path.resolve(settings.vaultPath);
      if (absPath.startsWith(vaultAbs + path.sep) && fs.existsSync(absPath)) {
        rawContent = fs.readFileSync(absPath, "utf-8");
      }
    }
    res.json({ ...page, rawContent });
  });

  // Sync wiki pages from disk into DB (rebuild FTS index)
  app.post("/api/wiki/sync", (req, res) => {
    const settings = storage.getVaultSettings();
    if (!settings.vaultPath) return res.status(400).json({ error: "No vault path" });
    try {
      storage.clearWikiPages();
      const synced = syncWikiToDb(settings.vaultPath);
      res.json({ synced });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Conversations ────────────────────────────────────────────────────────
  app.get("/api/conversations", (_req, res) => {
    res.json(storage.getConversations());
  });

  app.post("/api/conversations", (req, res) => {
    const conv = storage.createConversation(req.body);
    res.json(conv);
  });

  app.patch("/api/conversations/:id", (req, res) => {
    const updated = storage.updateConversation(parseInt(req.params.id), req.body);
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  });

  app.delete("/api/conversations/:id", (req, res) => {
    storage.deleteConversation(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ─── Messages ─────────────────────────────────────────────────────────────
  app.get("/api/conversations/:id/messages", (req, res) => {
    // Strip internal [WEB SEARCH RESULT] marker used for history detection
    // so it doesn't leak to the UI.
    const msgs = storage.getMessages(parseInt(req.params.id)).map(m =>
      m.role === "assistant" && m.content.startsWith("[WEB SEARCH RESULT]\n")
        ? { ...m, content: m.content.slice("[WEB SEARCH RESULT]\n".length) }
        : m
    );
    res.json(msgs);
  });

  app.post("/api/conversations/:id/chat", async (req, res) => {
    const conversationId = parseInt(req.params.id);
    const { message, mode } = req.body as { message: string; mode?: "kb" | "chat" };
    if (!message) return res.status(400).json({ error: "message required" });
    const chatMode: "kb" | "chat" = mode === "chat" ? "chat" : "kb";

    const conv = storage.getConversation(conversationId);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });

    const settings = storage.getVaultSettings();
    if (chatMode === "kb" && !settings.vaultPath) return res.status(400).json({ error: "No vault path set" });

    // Save user message
    storage.createMessage({ conversationId, role: "user", content: message });

    // Auto-title after first message
    if (storage.getMessages(conversationId).length === 1) {
      storage.updateConversation(conversationId, { title: message.slice(0, 60) });
    }

    try {
      if (chatMode === "chat") {
        const { answer, contextFiles } = await chatDirect(conversationId, message);
        const assistantMsg = storage.createMessage({
          conversationId,
          role: "assistant",
          content: answer,
          contextFiles: JSON.stringify(contextFiles),
        });
        res.json({ message: assistantMsg, contextFiles, mode: "chat" });
        return;
      }

      const pinnedFiles: string[] = JSON.parse(conv.pinnedFiles ?? "[]");
      const { answer, contextFiles, webSearchQuery } = await chatOverWiki(conversationId, message, pinnedFiles, settings.vaultPath);

      const assistantMsg = storage.createMessage({
        conversationId,
        role: "assistant",
        content: answer,
        contextFiles: JSON.stringify(contextFiles),
      });

      res.json({ message: assistantMsg, contextFiles, webSearchQuery, mode: "kb" });
    } catch (err: any) {
      const errMsg = storage.createMessage({
        conversationId,
        role: "assistant",
        content: `Error: ${err.message}`,
      });
      res.status(500).json({ message: errMsg, error: err.message });
    }
  });

  // ─── Web Search ──────────────────────────────────────────────────────────
  // POST /api/web-search — perform live web search and synthesise answer
  app.post("/api/web-search", async (req: Request, res: Response) => {
    const { query, originalQuestion, conversationId } = req.body;
    if (!query) return res.status(400).json({ error: "query required" });
    try {
      const { snippet, results } = await performWebSearch(query);
      const answer = await synthesiseWebAnswer(
        conversationId ?? 0,
        originalQuestion ?? query,
        query,
        snippet,
      );
      // Save as assistant message if conversation ID provided.
      // Prefix with a marker so future turns can detect that live data was
      // already fetched and avoid triggering a redundant web search.
      if (conversationId) {
        storage.createMessage({
          conversationId,
          role: "assistant",
          content: `[WEB SEARCH RESULT]\n${answer}`,
          contextFiles: JSON.stringify([]),
        });
      }
      res.json({ answer, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Processing status
  app.get("/api/status", (_req, res) => {
    res.json({ isProcessing: getIsProcessing() });
  });
}
