# KBuild — Knowledge Base Builder

> Turn any folder of documents into a queryable, chat-ready knowledge base — no cloud, no vector database, no RAG complexity.

Inspired by [Andrej Karpathy's LLM Knowledge Base pattern](https://x.com/karpathy/status/2039805659525644595): drop raw files into `raw/`, let an LLM compile them into interlinked Markdown in `wiki/`, then chat over the wiki using full-text search + context packing. Obsidian works great as a frontend for the wiki.

---

## Features

- **Vault management** — point KBuild at any folder; it creates `raw/`, `wiki/`, and `outputs/` automatically
- **File ingestion** — processes PDF, DOCX, PPTX, XLSX, HTML, CSV, Markdown, and TXT into full-content wiki pages
- **Full-text wiki** — every source becomes a complete Markdown wiki page; no summarisation, no data loss
- **KB Mode + Chat Mode** — toggle between knowledge-base-grounded answers (FTS5 full-text search packs the most relevant wiki pages into context; no vector DB needed) and a direct-LLM chat that bypasses the KB, with a visually distinct style so you always know which mode you're in
- **Custom system prompt** — edit the chat system prompt in **Settings** to tune tone, style, or constraints
- **Multiple LLM providers** — OpenRouter, xAI Grok, local Ollama, or any OpenAI-compatible endpoint
- **Separate models** — choose one model for processing/ingestion and another for chat
- **Per-file and global reprocess** — reprocess any file individually or reset everything and start fresh
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

The app runs as a local server (`localhost:3131`) — **your files and API keys never leave your machine.**

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20 LTS or newer | https://nodejs.org |
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

Open [http://localhost:3131](http://localhost:3131) in your browser.

### First-time setup in the UI

1. **Choose a vault** — click "Choose Vault" and pick (or create) any folder on your Mac. KBuild creates `raw/`, `wiki/`, and `outputs/` inside it.
2. **Add an LLM connection** — go to **Settings → Connections** and add your provider:
   - **OpenRouter** (recommended) — `https://openrouter.ai/api/v1` + your API key from [openrouter.ai/keys](https://openrouter.ai/keys)
   - **xAI Grok** — `https://api.x.ai/v1` + your xAI API key
   - **Local (Ollama)** — `http://localhost:11434/v1` — no key needed
3. **Select models** — go to **Settings → Models**, click "Refresh" next to each dropdown, and choose your processing and chat models.
   - Recommended processing model: `google/gemini-2.5-flash` (via OpenRouter)
   - Recommended chat model: `x-ai/grok-4.1-fast` (via OpenRouter)
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

Open [http://localhost:3131](http://localhost:3131) in your browser.

> **Note for Windows users:** The vault path uses standard Windows paths (e.g. `C:\Users\YourName\Documents\my-vault`). You can paste these directly into the vault chooser dialog.

### Running as a background service on Windows (optional)

```powershell
npm install -g pm2
npm run build
pm2 start "npm start" --name kbuild
pm2 startup
pm2 save
```

Then access it at [http://localhost:3131](http://localhost:3131) anytime.

---

## Supported File Types

| Format | Extension | Notes |
|--------|-----------|-------|
| Markdown | `.md` | Copied as-is, reformatted into wiki structure |
| Plain text | `.txt` | Direct ingestion |
| PDF | `.pdf` | Text extraction (not OCR — scanned PDFs won't work) |
| Word | `.docx` | Paragraph + heading extraction |
| PowerPoint | `.pptx` | Slide text extraction |
| Excel | `.xlsx` | Table-to-markdown conversion |
| CSV | `.csv` | Table-to-markdown conversion |
| HTML | `.html` | Tag-stripped text extraction |

---

## LLM Provider Setup

### OpenRouter (recommended — access 100+ models with one key)
1. Sign up at [openrouter.ai](https://openrouter.ai)
2. Get your key at [openrouter.ai/keys](https://openrouter.ai/keys)
3. In KBuild Settings → Connections → Add: type `OpenRouter`, paste your key
4. Recommended processing model: `google/gemini-2.5-flash`
5. Recommended chat model: `x-ai/grok-4.1-fast` ($0.20/$0.50 per M tokens)

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
npm run dev      # Start dev server with hot reload (port 3131)
npm run build    # Build client + server for production
npm start        # Run production build
npm run check    # TypeScript type check
```

---

## Environment Variables

Create a `.env` file in the project root to override defaults:

```env
PORT=3131          # Server port (default: 3131)
```

> **Security note:** Your LLM API keys are stored in the local SQLite database (`kb.db`) and never transmitted anywhere except to the LLM provider you configure. The database file is excluded from git.

---

## Tips

- **Use Obsidian as a wiki viewer** — open your vault folder in Obsidian. The compiled `wiki/` pages use standard Markdown with YAML frontmatter, so Obsidian's graph view, backlinks, and search all work natively.
- **Pinning context** — in the Chat view, use the context panel on the right to pin specific wiki pages so they're always included in the LLM context window.
- **Reprocessing** — if you update a file in `raw/`, use the per-row "Reprocess" button (hover over the row) or the global "Reprocess all" button in the Library header.
- **Wiki sync** — if you edit wiki pages directly in Obsidian, use the "Sync wiki" button to rebuild the FTS index from disk.
- **Model quality matters** — a stronger processing model produces better-structured wiki pages; a stronger chat model gives better answers. Processing is a one-time cost per file; chat costs per query.

---

## Desktop App (Windows)

KBuild can be installed as a standalone Windows desktop app — no Node, no terminal, no browser required.

### For end users

1. Download the latest `KBuild Setup <version>.exe` from the [GitHub Releases page](https://github.com/sirnoeris/kbuild/releases).
2. Run the installer — it adds KBuild to the Start Menu and (optionally) the desktop.
3. Launch KBuild. It starts the local server in the background and opens the UI in its own window. All data (`kb.db`, settings) is stored in `%APPDATA%\KBuild`.

### For developers

Electron scaffolding lives in `electron/`. To build the Windows installer locally:

```powershell
# On Windows (x64)
npm install
npm run electron:build:win
# → release/KBuild Setup <version>.exe
```

On macOS/Linux you can smoke-test the Electron shell against your local build:

```bash
npm run build
npm run electron:dev
```

Automated Windows builds are produced by the `.github/workflows/electron-build.yml` workflow on every push to `main` and attached as release artifacts.

---

## Roadmap

- [ ] File watcher — auto-detect new files dropped into `raw/` without manual scan
- [ ] Incremental re-processing — only reprocess changed files
- [ ] Export chat threads to `outputs/`
- [x] Electron wrapper — run as a proper desktop app without keeping a terminal open
- [ ] OCR support for scanned PDFs
- [ ] Streaming chat responses

---

## License

MIT — see [LICENSE](LICENSE)

---

## Acknowledgements

- [Andrej Karpathy](https://x.com/karpathy) — for the original LLM Knowledge Base pattern
- [shadcn/ui](https://ui.shadcn.com) — component primitives
- [Drizzle ORM](https://orm.drizzle.team) — SQLite layer
