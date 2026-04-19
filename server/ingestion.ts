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
  writeSourceWikiPage,
  regenerateIndexFiles,
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

const CONVERT_PROMPT = `You are a precise document formatter. Your job is to convert raw extracted document text into a clean, well-structured Markdown wiki page.

RULES:
- Preserve ALL content — do not omit, summarise, or paraphrase anything.
- Use proper Markdown headings (##, ###) to reflect the document's own structure. If the document has sections, use them. Do not invent sections.
- Keep all numbers, statistics, p-values, tables, references, and specific details exactly as they appear.
- Format tables as Markdown tables where applicable.
- Keep lists as Markdown bullet or numbered lists.
- Do not add commentary, interpretation, or content not present in the source.
- Do not add a preamble or closing statement — output the Markdown document only.
- Start with a # Heading using the document title.`;

// Large docs are chunked: convert each chunk separately then concatenate.
// Gemini Flash 2.5 has a 1M token context so 40k chars per chunk is conservative.
const CHUNK_SIZE = 40_000;

async function convertChunkWithRetry(
  connectionId: number,
  model: string,
  chunk: string,
  docTitle: string,
  chunkIndex: number,
  totalChunks: number,
  maxRetries: number
): Promise<string> {
  const chunkNote = totalChunks > 1 ? ` (part ${chunkIndex + 1} of ${totalChunks})` : "";
  const userContent = totalChunks > 1 && chunkIndex > 0
    ? `Document title: ${docTitle}${chunkNote}\n\nThis is a continuation. Continue converting from where the previous part left off — do not repeat headings already covered.\n\n${chunk}`
    : `Document title: ${docTitle}${chunkNote}\n\n${chunk}`;

  let lastError = "";
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
    try {
      const result = await callLLM(connectionId, model, [
        { role: "system", content: CONVERT_PROMPT },
        { role: "user", content: userContent },
      ], { temperature: 0.1, max_tokens: 8192 });
      return result.content;
    } catch (err: any) {
      lastError = err.message;
    }
  }
  throw new Error(`All ${maxRetries} attempts failed. Last error: ${lastError}`);
}

async function convertDocToMarkdown(
  connectionId: number,
  model: string,
  docText: string,
  docTitle: string,
  maxRetries: number
): Promise<string> {
  if (!docText.trim()) return `# ${docTitle}\n\n_No text content could be extracted from this file._`;

  // Split into chunks if needed
  const chunks: string[] = [];
  for (let i = 0; i < docText.length; i += CHUNK_SIZE) {
    chunks.push(docText.slice(i, i + CHUNK_SIZE));
  }

  const parts = await Promise.all(
    chunks.map((chunk, i) => convertChunkWithRetry(connectionId, model, chunk, docTitle, i, chunks.length, maxRetries))
  );

  // Join parts — strip duplicate leading heading from continuation chunks
  return parts.map((part, i) => {
    if (i === 0) return part;
    // Remove leading # heading if it's a repeat of the title
    return part.replace(/^#\s+.+\n+/, "").trimStart();
  }).join("\n\n");
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
        // 1. Extract raw text from file
        const doc = await extractDocument(absPath, vaultRoot);
        if (doc.error && !doc.text) {
          throw new Error(doc.error);
        }

        const sourceText = doc.text || `[${doc.kind.toUpperCase()} file: ${doc.title}. No text could be extracted.]`;

        if (process.env.NODE_ENV !== "production") {
          console.log(`[ingestion] Extracted "${doc.title}": ${sourceText.length} chars`);
        }

        // 2. Convert to clean Markdown (full text, no summarisation)
        const markdownBody = await convertDocToMarkdown(
          settings.processingConnectionId!,
          settings.processingModel!,
          sourceText,
          doc.title,
          maxRetries
        );

        if (process.env.NODE_ENV !== "production") {
          console.log(`[ingestion] Converted "${doc.title}": ${markdownBody.length} chars of Markdown`);
        }

        // 3. Write wiki page (full markdown body)
        const wikiPath = writeSourceWikiPage(vaultRoot, file.path, doc.title, markdownBody);

        // 4. Update registry — derive a short summary from the first non-heading paragraph
        const firstPara = markdownBody.split(/\n{2,}/).find(l => l.trim() && !l.startsWith("#")) ?? "";
        const shortSummary = firstPara.replace(/[#*_`]/g, "").slice(0, 300);

        storage.updateFile(file.id, {
          status: "done",
          wikiPath,
          title: doc.title,
          tags: "[]",
          summary: shortSummary,
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

  // Regenerate index files (sources list)
  try { regenerateIndexFiles(vaultRoot); } catch {}

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
// Pass up to 100k chars of wiki content to the chat LLM.
// Grok-3-fast has 128k context, Gemini Flash has 1M — both can handle this comfortably.
const TOKEN_BUDGET = 100_000;

const CHAT_SYSTEM = `You are a precise research assistant with access to a curated knowledge base.
Answer questions using ONLY the wiki documents provided below.
Be specific — include exact numbers, p-values, names, dates, and quotes from the source where relevant.
Always cite which document(s) you drew from, by title.
If the information is not present in the provided documents, say so clearly — do not speculate or invent.`;

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

  // 1. FTS search — include recent conversation history so follow-up questions
  // (e.g. "can you calculate that?") still retrieve the right sources even when
  // the current message alone doesn't contain enough keywords.
  const recentHistory = storage.getMessages(conversationId).slice(-4); // last 4 messages
  const recentUserText = recentHistory
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join(" ");
  const searchQuery = recentUserText
    ? `${userMessage} ${recentUserText}`.slice(0, 500) // cap to avoid over-broad queries
    : userMessage;
  const searchResults = storage.searchWikiPages(searchQuery, 6);

  // 2. Add pinned files
  const pinned = pinnedFiles
    .map(p => storage.getWikiPageByPath(p))
    .filter(Boolean) as any[];

  // 3. Deduplicate and prioritize pinned
  const seen = new Set<string>();
  const candidates: typeof searchResults = [];
  for (const p of pinned) { if (!seen.has(p.path)) { seen.add(p.path); candidates.push(p); } }
  for (const r of searchResults) { if (!seen.has(r.path)) { seen.add(r.path); candidates.push(r); } }

  // 4. Pack under token budget (full body, no slice)
  let budget = TOKEN_BUDGET;
  const chosen: typeof candidates = [];
  for (const page of candidates) {
    const size = page.body?.length ?? 0;
    if (chosen.length > 0 && budget - size < 0) break; // always include at least 1
    budget -= size;
    chosen.push(page);
  }

  // 5. Build context — pass full body so no information is lost
  const contextBlocks = chosen.map(p =>
    `## ${p.title}\n_Source: ${p.path}_\n\n${p.body}`
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
