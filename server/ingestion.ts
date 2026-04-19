/**
 * Ingestion pipeline — scan raw/, extract, summarize, write wiki.
 * Emits events via a global event emitter for SSE streaming.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import EventEmitter from "events";
import { storage } from "./storage.js";
import { callLLM } from "./llm-client.js";
import { extractDocument, getFileKind } from "./extractor.js";
import {
  parseSummaryFromLLM,
  writeSourceWikiPage,
  ensureTopicPage,
  regenerateIndexFiles,
  slugify,
} from "./wiki-writer.js";

export const ingestionEvents = new EventEmitter();
ingestionEvents.setMaxListeners(50);

export function emitProgress(event: string, data: unknown) {
  ingestionEvents.emit("progress", { event, data });
}

function hashFile(filePath: string): string {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash("md5").update(buf).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

export async function scanRawFolder(vaultRoot: string): Promise<{ newCount: number; changedCount: number; total: number }> {
  const rawDir = path.join(vaultRoot, "raw");
  if (!fs.existsSync(rawDir)) {
    fs.mkdirSync(rawDir, { recursive: true });
    return { newCount: 0, changedCount: 0, total: 0 };
  }

  const supportedKinds = ["pdf", "html", "docx", "pptx", "xlsx", "csv", "md", "txt"];
  const settings = storage.getVaultSettings();
  const enabledFormats: string[] = JSON.parse(settings.enabledFormats ?? '[]');

  let newCount = 0, changedCount = 0, total = 0;

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fullPath); continue; }

      const kind = getFileKind(entry.name);
      if (kind === "other") continue;
      if (!enabledFormats.includes(kind)) continue;

      const relPath = path.relative(vaultRoot, fullPath);
      const stat = fs.statSync(fullPath);
      const hash = hashFile(fullPath);
      total++;

      const existing = storage.getFileByPath(relPath);
      if (!existing) {
        storage.createFile({
          path: relPath,
          kind,
          hash,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          status: "pending",
        });
        newCount++;
      } else if (existing.hash !== hash) {
        storage.updateFile(existing.id, { hash, size: stat.size, mtime: stat.mtime.toISOString(), status: "pending", errorMessage: null });
        changedCount++;
      }
    }
  }

  walk(rawDir);

  // Update last scan time
  storage.updateVaultSettings({ lastScanAt: new Date().toISOString() });

  emitProgress("scan_complete", { newCount, changedCount, total });
  return { newCount, changedCount, total };
}

const SUMMARIZE_PROMPT = `You are a knowledge base compiler. Given the content of a document, produce a structured summary in JSON.

Return ONLY valid JSON (no markdown fences) with these keys:
{
  "title": "Human-readable title",
  "summary": "One-paragraph summary (2-4 sentences)",
  "key_points": ["point 1", "point 2", ...], // 3-8 bullet points
  "concepts": ["concept1", "concept2", ...], // 3-10 key concepts/topics (short sluggable strings)
  "related_topics": ["topic1", "topic2", ...] // 2-5 related topic names
}`;

async function summarizeWithRetry(
  connectionId: number,
  model: string,
  docText: string,
  docTitle: string,
  maxRetries: number
): Promise<string> {
  let lastError = "";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    try {
      const result = await callLLM(connectionId, model, [
        { role: "system", content: SUMMARIZE_PROMPT },
        { role: "user", content: `Document title: ${docTitle}\n\n${docText.slice(0, 20_000)}` },
      ], { temperature: 0.2, max_tokens: 2048 });
      return result.content;
    } catch (err: any) {
      lastError = err.message;
    }
  }
  throw new Error(`All ${maxRetries} attempts failed. Last error: ${lastError}`);
}

let isProcessing = false;

export async function processPendingFiles(vaultRoot: string): Promise<{ processed: number; errors: number }> {
  if (isProcessing) throw new Error("Processing already in progress");
  isProcessing = true;

  const settings = storage.getVaultSettings();
  if (!settings.processingConnectionId || !settings.processingModel) {
    isProcessing = false;
    throw new Error("No processing model configured. Please configure a connection and model in Settings.");
  }

  const maxConcurrent = settings.maxConcurrent ?? 2;
  const maxRetries = settings.maxRetries ?? 3;

  const pending = storage.getFiles().filter(f => f.status === "pending");
  let processed = 0, errors = 0;

  emitProgress("processing_start", { total: pending.length });

  // Process in batches
  for (let i = 0; i < pending.length; i += maxConcurrent) {
    const batch = pending.slice(i, i + maxConcurrent);
    await Promise.all(batch.map(async (file) => {
      const absPath = path.join(vaultRoot, file.path);
      storage.updateFile(file.id, { status: "processing" });
      emitProgress("file_start", { id: file.id, path: file.path });

      try {
        // 1. Extract
        const doc = await extractDocument(absPath, vaultRoot);
        if (doc.error && !doc.text) {
          throw new Error(doc.error);
        }

        // 2. Summarize
        const rawSummary = await summarizeWithRetry(
          settings.processingConnectionId!,
          settings.processingModel!,
          doc.text || doc.error || `File: ${doc.title} (${doc.kind})`,
          doc.title,
          maxRetries
        );

        // 3. Parse
        const result = parseSummaryFromLLM(rawSummary, doc.title);

        // 4. Write wiki page
        const wikiPath = writeSourceWikiPage(vaultRoot, file.path, result);

        // 5. Ensure topic stubs
        for (const topic of result.relatedTopics.concat(result.concepts)) {
          const slug = slugify(topic);
          if (slug) ensureTopicPage(vaultRoot, slug, topic);
        }

        // 6. Update registry
        storage.updateFile(file.id, {
          status: "done",
          wikiPath,
          title: result.title,
          tags: JSON.stringify(result.concepts.slice(0, 8)),
          summary: result.summary,
          processedAt: new Date().toISOString(),
          errorMessage: null,
        });

        processed++;
        emitProgress("file_done", { id: file.id, path: file.path, wikiPath });
      } catch (err: any) {
        storage.updateFile(file.id, { status: "error", errorMessage: err.message });
        errors++;
        emitProgress("file_error", { id: file.id, path: file.path, error: err.message });
      }
    }));
  }

  // Regenerate index files
  regenerateIndexFiles(vaultRoot);

  // Auto-sync wiki pages into FTS index so chat works immediately
  syncWikiToDb(vaultRoot);

  // Save run summary
  storage.updateVaultSettings({
    lastRunSummary: JSON.stringify({ processedCount: processed, errorCount: errors, timestamp: new Date().toISOString() })
  });

  emitProgress("processing_complete", { processed, errors });
  isProcessing = false;
  return { processed, errors };
}

/**
 * Walk the wiki/ directory on disk and upsert every .md file into the
 * SQLite wiki_pages table + FTS index. Called automatically after processing
 * and exposed for manual "Sync wiki" triggers.
 */
export function syncWikiToDb(vaultRoot: string): number {
  const wikiDir = path.join(vaultRoot, "wiki");
  if (!fs.existsSync(wikiDir)) return 0;

  let synced = 0;
  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(fullPath); continue; }
      if (!entry.name.endsWith(".md")) continue;

      const relPath = path.relative(vaultRoot, fullPath);
      const content = fs.readFileSync(fullPath, "utf-8");

      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      let title = entry.name.replace(".md", "");
      let type: "source" | "topic" = "source";
      let tags = "[]";
      let sourceFile: string | undefined;

      if (fmMatch) {
        const fm = fmMatch[1];
        const titleMatch = fm.match(/^title:\s*"?(.+?)"?\s*$/m);
        if (titleMatch) title = titleMatch[1];
        if (/^type:\s*"?topic"?/m.test(fm)) type = "topic";
        const sfMatch = fm.match(/^source:\s*"?(.+?)"?\s*$/m);
        if (sfMatch) sourceFile = sfMatch[1];
      }

      const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content;
      const summary = body.split("\n\n")[0]?.slice(0, 300) ?? "";

      storage.upsertWikiPage({
        path: relPath, title, type, tags, summary, body,
        sourceFile, lastUpdated: new Date().toISOString()
      });
      synced++;
    }
  }
  walk(wikiDir);
  return synced;
}

export function getIsProcessing() { return isProcessing; }

// ─── Chat Engine ────────────────────────────────────────────────────────────
const TOKEN_BUDGET = 12_000; // ~chars per wiki file budget

const CHAT_SYSTEM = `You are a helpful research assistant with access to a curated knowledge base (wiki).
Answer questions ONLY based on the wiki context provided below.
Always cite the source wiki files you used, mentioning them by title.
If the answer is not in the wiki, say so honestly — do not make things up.
Format your answer in clear markdown with headings and bullet points where appropriate.`;

export async function chatOverWiki(
  conversationId: number,
  userMessage: string,
  pinnedFiles: string[],
  vaultRoot: string
): Promise<{ answer: string; contextFiles: string[] }> {
  const settings = storage.getVaultSettings();
  if (!settings.chatConnectionId || !settings.chatModel) {
    throw new Error("No chat model configured. Please configure a connection and model in Settings.");
  }

  // 1. FTS search
  const searchResults = storage.searchWikiPages(userMessage, 12);

  // 2. Add pinned files
  const pinned = pinnedFiles
    .map(p => storage.getWikiPageByPath(p))
    .filter(Boolean) as any[];

  // 3. Deduplicate and prioritize pinned
  const seen = new Set<string>();
  const candidates: typeof searchResults = [];
  for (const p of pinned) { if (!seen.has(p.path)) { seen.add(p.path); candidates.push(p); } }
  for (const r of searchResults) { if (!seen.has(r.path)) { seen.add(r.path); candidates.push(r); } }

  // 4. Pack under token budget
  let budget = TOKEN_BUDGET;
  const chosen: typeof candidates = [];
  for (const page of candidates) {
    const size = (page.summary?.length ?? 0) + (page.body?.length ?? 0);
    if (budget - size < 0) break;
    budget -= size;
    chosen.push(page);
  }

  // 5. Build context
  const contextBlocks = chosen.map(p =>
    `## ${p.title}\n_Source: ${p.path}_\n\n${p.summary}\n\n${p.body.slice(0, 3000)}`
  ).join("\n\n---\n\n");

  const contextFiles = chosen.map(p => p.path);

  // 6. Get conversation history
  const history = storage.getMessages(conversationId).slice(-8); // last 8 messages
  const historyMessages = history.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  // 7. Call LLM
  const messages = [
    { role: "system" as const, content: CHAT_SYSTEM + "\n\n# Wiki Context\n\n" + (contextBlocks || "No wiki pages found yet. Process some files first.") },
    ...historyMessages,
    { role: "user" as const, content: userMessage },
  ];

  const result = await callLLM(settings.chatConnectionId, settings.chatModel, messages, { temperature: 0.4, max_tokens: 2048 });

  return { answer: result.content, contextFiles };
}
