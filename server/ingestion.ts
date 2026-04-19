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

function buildChatSystem(): string {
  const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  return `You are a precise research assistant with access to a curated knowledge base.
Today's date is ${today}.
Answer questions using ONLY the wiki documents provided below.
Be specific — include exact numbers, p-values, names, dates, and quotes from the source where relevant.
Always cite which document(s) you drew from, by title.
If the information is not present in the provided documents, say so clearly — do not speculate or invent.

IMPORTANT — WEB SEARCH RULE:
If the user asks for anything described as "current", "today", "now", "latest", "live", or "real-time"
(e.g. current stock price, today's value, latest news, live exchange rate),
YOU MUST emit the web search tag — even if the KB contains older data on the same topic.
Do NOT answer with stale KB data as if it were current. Instead, provide what the KB shows,
then always append the tag so live data can be fetched.

Also emit the tag when the KB clearly lacks the answer entirely.

Format — include this exact tag at the END of your answer, on its own line:
[[WEB_SEARCH: <a concise, specific search query including ticker/name and today's date>]]

Do NOT emit it for general knowledge questions that don't require live data.`;
}

export async function chatOverWiki(
  conversationId: number,
  userMessage: string,
  pinnedFiles: string[],
  vaultRoot: string
): Promise<{ answer: string; contextFiles: string[]; webSearchQuery?: string }> {
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

  // If a recent assistant turn already contains fetched live data, tell the
  // LLM to prefer answering from it instead of emitting another web-search tag.
  const hasRecentLiveData = history.some(
    m => m.role === "assistant" && m.content.startsWith("[WEB SEARCH RESULT]")
  );
  const liveDataNote = hasRecentLiveData
    ? "\n\n# Recently Fetched Live Data\nThe following live web search result was already fetched earlier in this conversation and is present in the chat history above (marked with [WEB SEARCH RESULT]). If the user's follow-up question can be answered using this data, answer it directly. Do NOT emit [[WEB_SEARCH:...]] — that would cause a redundant search. Only emit [[WEB_SEARCH:...]] if the user is asking about something genuinely different that requires NEW live data not already present in the history."
    : "";

  // 7. Call LLM
  const messages = [
    { role: "system" as const, content: buildChatSystem() + "\n\n# Wiki Context\n\n" + (contextBlocks || "No wiki pages found yet. Process some files first.") + liveDataNote },
    ...historyMessages,
    { role: "user" as const, content: userMessage },
  ];

  const result = await callLLM(settings.chatConnectionId, settings.chatModel, messages, { temperature: 0.4, max_tokens: 2048 });

  // Parse optional web-search suggestion emitted by the LLM
  const raw = result.content as string;
  const webSearchMatch = raw.match(/\[\[WEB_SEARCH:\s*(.+?)\]\]/i);
  const webSearchQuery = webSearchMatch ? webSearchMatch[1].trim() : undefined;
  // Strip the tag from the visible answer
  const answer = raw.replace(/\n?\[\[WEB_SEARCH:[^\]]*\]\]/gi, "").trim();

  return { answer, contextFiles, webSearchQuery };
}

// ─── Web Search ─────────────────────────────────────────────────────────────
// Supports: Brave Search, Serper.dev, xAI Live Search (Responses API)

export async function performWebSearch(query: string): Promise<{ snippet: string; results: { title: string; url: string; snippet: string }[] }> {
  const settings = storage.getVaultSettings();

  if (!settings.webSearchEnabled) {
    throw new Error("Web search is not enabled. Enable it in Settings → Web Search.");
  }

  const provider = settings.webSearchProvider ?? "brave";
  const apiKey = settings.webSearchApiKey ?? "";

  // ─── xAI Live Search ──────────────────────────────────────────────────
  // Uses xAI Responses API — search + synthesis in a single call.
  // Key is resolved from the selected Connection (webSearchConnectionId),
  // not the generic webSearchApiKey field.
  if (provider === "xai") {
    // Resolve the xAI API key: prefer a saved xAI Connection, fall back to the
    // direct webSearchApiKey field (for users who haven't added a Connection yet).
    let xaiKey = "";
    const connId = settings.webSearchConnectionId;
    if (connId) {
      const conn = storage.getConnection(connId);
      if (!conn) {
        throw new Error(`xAI web search: connection #${connId} not found. Re-select it in Settings → Web Search.`);
      }
      if (conn.type !== "xai") {
        throw new Error(`xAI web search: the selected connection "${conn.name}" is type "${conn.type}", not "xai". Please select an xAI-type connection, or paste your xAI key directly in Settings → Web Search.`);
      }
      xaiKey = conn.apiKey ?? "";
    } else {
      // Direct key fallback (stored in webSearchApiKey)
      xaiKey = settings.webSearchApiKey ?? "";
    }
    if (!xaiKey) {
      throw new Error("xAI web search: no API key found. Paste your xAI key in Settings → Web Search.");
    }
    const resp = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${xaiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4-fast",     // current Responses API model with web_search support
        input: [{ role: "user", content: `Today is ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}. ${query}` }],
        tools: [{ type: "web_search" }],
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`xAI Responses API error ${resp.status}: ${errText.slice(0, 300)}`);
    }
    const data = await resp.json() as any;

    // Extract answer text + inline citation annotations from output[]
    // Response shape: data.output[] -> { type: "message", content: [ { type: "output_text", text, annotations: [ { type: "url_citation", url, title } ] } ] }
    let answer = "";
    const seenUrls = new Set<string>();
    const results: { title: string; url: string; snippet: string }[] = [];

    for (const item of (data.output ?? [])) {
      for (const c of (item.content ?? [])) {
        if (c.type === "output_text") {
          answer += c.text ?? "";
          // Pull citations from inline annotations
          for (const ann of (c.annotations ?? [])) {
            if (ann.type === "url_citation" && ann.url && !seenUrls.has(ann.url)) {
              seenUrls.add(ann.url);
              results.push({
                title: ann.title && isNaN(Number(ann.title)) ? ann.title : ann.url,
                url: ann.url,
                snippet: ann.url, // annotations don't carry snippets; URL is the reference
              });
            }
          }
        }
      }
    }

    // Fallback: data.citations is a flat string[] of URLs (no title/snippet)
    if (results.length === 0) {
      for (const url of (data.citations ?? []).slice(0, 6)) {
        if (typeof url === "string" && !seenUrls.has(url)) {
          seenUrls.add(url);
          results.push({ title: url, url, snippet: url });
        }
      }
    }

    return { snippet: answer.trim() || "No answer returned.", results: results.slice(0, 6) };
  }

  // Brave & Serper require a manual API key stored in webSearchApiKey
  if (!apiKey) {
    const providerName = provider === "serper" ? "Serper" : "Brave Search";
    throw new Error(`Web search API key not set. Add your ${providerName} API key in Settings → Web Search.`);
  }

  if (provider === "serper") {
    // Serper.dev — Google results, reliable for financial data
    const resp = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, num: 6 }),
    });
    if (!resp.ok) throw new Error(`Serper API error: ${resp.status} ${await resp.text().then(t => t.slice(0, 200))}`);
    const data = await resp.json() as any;

    const results: { title: string; url: string; snippet: string }[] = [];

    // Answer box (best direct answer)
    if (data.answerBox?.answer) {
      results.push({ title: data.answerBox.title ?? query, url: data.answerBox.link ?? "", snippet: data.answerBox.answer });
    } else if (data.answerBox?.snippet) {
      results.push({ title: data.answerBox.title ?? query, url: data.answerBox.link ?? "", snippet: data.answerBox.snippet });
    }

    // Knowledge graph
    if (data.knowledgeGraph?.description) {
      results.push({ title: data.knowledgeGraph.title ?? "", url: data.knowledgeGraph.website ?? "", snippet: data.knowledgeGraph.description });
    }

    // Organic results
    for (const r of (data.organic ?? []).slice(0, 5)) {
      if (r.title && r.snippet) results.push({ title: r.title, url: r.link ?? "", snippet: r.snippet });
    }

    const snippet = results.map(r => r.snippet).join(" \n").slice(0, 2000) || "No results found.";
    return { snippet, results: results.slice(0, 6) };

  } else {
    // Brave Search API — default
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&result_filter=web`;
    const resp = await fetch(url, {
      headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": apiKey },
    });
    if (!resp.ok) throw new Error(`Brave Search API error: ${resp.status} ${await resp.text().then(t => t.slice(0, 200))}`);
    const data = await resp.json() as any;

    const results: { title: string; url: string; snippet: string }[] = [];

    for (const r of (data.web?.results ?? []).slice(0, 6)) {
      if (r.title && r.description) results.push({ title: r.title, url: r.url ?? "", snippet: r.description });
    }

    // Infobox if available
    if (data.infobox?.results?.[0]?.description) {
      results.unshift({ title: data.infobox.results[0].title ?? query, url: data.infobox.results[0].url ?? "", snippet: data.infobox.results[0].description });
    }

    const snippet = results.map(r => r.snippet).join(" \n").slice(0, 2000) || "No results found.";
    return { snippet, results: results.slice(0, 6) };
  }
}

export async function synthesiseWebAnswer(
  conversationId: number,
  originalQuestion: string,
  searchQuery: string,
  webSnippet: string,
): Promise<string> {
  const settings = storage.getVaultSettings();

  // xAI Responses API already returns a synthesised, grounded answer — skip re-synthesis.
  // Re-passing the text through another LLM would add latency and risk distortion.
  if ((settings.webSearchProvider ?? "brave") === "xai") {
    return webSnippet;
  }

  if (!settings.chatConnectionId || !settings.chatModel) throw new Error("No chat model configured.");

  const messages = [
    {
      role: "system" as const,
      content: `You are a helpful assistant. The user asked a question that required a web search.
Using the web search results below, give a concise, accurate answer.
Always note that this information comes from a live web search, not the knowledge base.
Do not speculate beyond what the search results say.`,
    },
    {
      role: "user" as const,
      content: `Original question: ${originalQuestion}\n\nWeb search query used: "${searchQuery}"\n\nSearch results:\n${webSnippet}`,
    },
  ];

  const result = await callLLM(settings.chatConnectionId, settings.chatModel, messages, { temperature: 0.3, max_tokens: 1024 });
  return result.content as string;
}
