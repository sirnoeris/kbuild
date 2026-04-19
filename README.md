# KBuild — Knowledge Base Builder

> Turn any folder of documents into a queryable, chat-ready knowledge base — no cloud, no vector database, no RAG complexity.

Inspired by [Andrej Karpathy's LLM Knowledge Base pattern](https://x.com/karpathy/status/2039805659525644595): drop raw files into `raw/`, let an LLM compile them into interlinked Markdown in `wiki/`, then chat over the wiki using full-text search + context packing. Obsidian works great as a frontend for the wiki.

![KBuild Screenshot](https://raw.githubusercontent.com/sirnoeris/kbuild/main/docs/screenshot.png)

---

## Features

- **Vault management** — point KBuild at any folder; it creates `raw/`, `wiki/`, and `outputs/` automatically
- **File ingestion** — processes PDF, DOCX, PPTX, XLSX, HTML, CSV, Markdown, and TXT into structured wiki pages
- **Wiki compiler** — each source gets its own `wiki/sources/<slug>.md` page; cross-topic pages land in `wiki/topics/`
- **Chat over wiki** — full-text search (SQLite FTS5) packs the most relevant wiki pages into context; no vector DB needed
- **Multiple LLM providers** — OpenRouter, xAI Grok, local Ollama, or any OpenAI-compatible endpoint
- **Separate models** — choose one model for processing/ingestion and another for chat
- **Dark mode first** — system preference respected, toggle in sidebar
- **Live progress** — SSE-powered real-time updates during ingestion

---

## Architecture

```
kb-app/
├── client/          # React + Vite frontend (TypeScript)
│   └── src/
│       ├── pages/   # Library, Chat, Settings views
│       └── components/
├── server/          # Express backend (TypeScript)
│   ├── extractor.ts    # File → plain text extraction
│   ├── wiki-writer.ts  # Plain text → wiki Markdown
│   ├── ingestion.ts    # Orchestration + SSE events
│   ├── llm-client.ts   # OpenAI-compatible LLM client
│   ├── storage.ts      # SQLite via Drizzle ORM + FTS5
│   └── routes.ts       # REST API routes
├── shared/
│   └── schema.ts    # Drizzle schema (shared client/server)
└── dist/            # Production build output (git-ignored)
```

The app runs as a local server (`localhost:5000`) — **your files and API keys never leave your machine.**

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18 or 20 LTS | https://nodejs.org |
| npm | comes with Node | — |

> **Optional:** [Obsidian](https://obsidian.md) — open your vault folder in Obsidian to browse and search the compiled wiki pages with its native graph view and search.

---

## Quick Start — macOS

```bash
# 1. Clone the repo
git clone https://github.com/sirnoeris/kbuild.git
cd kbuild

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

### First-time setup in the UI

1. **Choose a vault** — click "Choose Vault" and pick (or create) any folder on your Mac. KBuild creates `raw/`, `wiki/`, and `outputs/` inside it.
2. **Add an LLM connection** — go to **Settings → Connections** and add your provider:
   - **OpenRouter** (recommended) — `https://openrouter.ai/api/v1` + your API key from [openrouter.ai/keys](https://openrouter.ai/keys)
   - **xAI Grok** — `https://api.x.ai/v1` + your xAI API key
   - **Local (Ollama)** — `http://localhost:11434/v1` — no key needed
3. **Select models** — go to **Settings → Models**, click "Refresh" next to each dropdown, and choose your processing and chat models.
4. **Drop files into `raw/`** — add PDFs, Word docs, CSVs, or any supported file.
5. **Scan** — click "Scan raw/" in the Library view to detect new files.
6. **Process** — click "Process raw/" to compile them into the wiki.
7. **Chat** — switch to the Chat view and ask questions about your knowledge base.

### Production build (run without the dev tools overhead)

```bash
npm run build
npm start
```

---

## Quick Start — Windows

> Tested on Windows 10/11 with PowerShell or Windows Terminal.

```powershell
# 1. Install Node.js from https://nodejs.org (LTS version)
#    Make sure to check "Add to PATH" during installation.

# 2. Clone the repo (requires Git — https://git-scm.com/download/win)
git clone https://github.com/sirnoeris/kbuild.git
cd kbuild

# 3. Install dependencies
npm install

# 4. Start the development server
npm run dev
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

> **Note for Windows users:** The vault path uses standard Windows paths (e.g. `C:\Users\YourName\Documents\my-vault`). You can paste these directly into the vault chooser dialog.

### Running as a background service on Windows (optional)

If you want KBuild to start automatically and run in the background:

```powershell
# Install pm2 globally
npm install -g pm2

# Build first
npm run build

# Start with pm2
pm2 start "npm start" --name kbuild

# Auto-start on login
pm2 startup
pm2 save
```

Then access it at [http://localhost:5000](http://localhost:5000) anytime.

---

## Supported File Types

| Format | Extension | Notes |
|--------|-----------|-------|
| Markdown | `.md` | Copied as-is, re-formatted into wiki structure |
| Plain text | `.txt` | Direct ingestion |
| PDF | `.pdf` | Text extraction (not OCR — scanned PDFs won't work) |
| Word | `.docx` | Paragraph + heading extraction |
| PowerPoint | `.pptx` | Slide text extraction |
| Excel / CSV | `.xlsx`, `.csv` | Table-to-markdown conversion |
| HTML | `.html` | Tag-stripped text extraction |

---

## LLM Provider Setup

### OpenRouter (recommended — access 100+ models with one key)
1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Get your key at [openrouter.ai/keys](https://openrouter.ai/keys)
3. In KBuild Settings → Connections → Add: type `OpenRouter`, paste your key
4. Good free/cheap models for processing: `google/gemini-flash-1.5`, `meta-llama/llama-3.1-8b-instruct:free`
5. Good models for chat: `anthropic/claude-3.5-haiku`, `openai/gpt-4o-mini`

### xAI Grok
1. Get your key at [console.x.ai](https://console.x.ai)
2. Base URL: `https://api.x.ai/v1`

### Local (Ollama — fully offline)
1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3.2` or `ollama pull mistral`
3. Base URL: `http://localhost:11434/v1` — no API key needed
4. Model name: use the Ollama model tag (e.g. `llama3.2`, `mistral`)

---

## Development Scripts

```bash
npm run dev      # Start dev server with hot reload (port 5000)
npm run build    # Build client + server for production
npm start        # Run production build
npm run check    # TypeScript type check
```

---

## Environment Variables

Create a `.env` file in the project root to override defaults:

```env
PORT=5000          # Server port (default: 5000)
```

> **Security note:** Your LLM API keys are stored in the local SQLite database (`kb.db`) and never transmitted anywhere except to the LLM provider you configure. The database file is excluded from git.

---

## Tips

- **Use Obsidian as a wiki viewer** — open your vault folder in Obsidian. The compiled `wiki/` pages use standard Markdown with YAML frontmatter and `[[wikilinks]]`, so Obsidian's graph view, backlinks, and search all work natively.
- **Pinning context** — in the Chat view, use the context panel on the right to pin specific wiki pages so they're always included in the LLM context window.
- **Re-processing** — if you update a file in `raw/`, use "Retry" on that file or "Reset all" to reprocess everything.
- **Wiki sync** — if you edit wiki pages directly in Obsidian, use the "Sync wiki" button to rebuild the FTS index from disk.
- **Token budget** — processing uses ~2,000 output tokens per file and chat uses ~12,000 context chars per query. Adjust in Settings → Behavior if you hit rate limits.

---

## Roadmap

- [ ] File watcher — auto-detect new files dropped into `raw/` without manual scan
- [ ] Incremental re-processing — only reprocess changed files
- [ ] Export chat threads to `outputs/`
- [ ] Electron wrapper — run as a proper desktop app without keeping a terminal open
- [ ] OCR support for scanned PDFs

---

## License

MIT — see [LICENSE](LICENSE)

---

## Acknowledgements

- [Andrej Karpathy](https://x.com/karpathy) — for the original LLM Knowledge Base pattern
- [llm-wiki-compiler](https://github.com/atomicmemory/llm-wiki-compiler) — raw → wiki compilation concept
- [Graphify](https://github.com/safishamsi/graphify) — knowledge graph inspiration
- [shadcn/ui](https://ui.shadcn.com) — component primitives
- [Drizzle ORM](https://orm.drizzle.team) — SQLite layer
