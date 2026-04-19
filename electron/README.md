# Electron Wrapper

This directory contains the Electron main-process code and packaging assets for
the KBuild desktop app.

## Files

- `main.js` — Electron entry point. Spawns `dist/index.cjs` (the bundled Express
  server) as a child process, waits for it to bind to `127.0.0.1:3131`, then
  opens a BrowserWindow pointed at the server.
- `icon.ico` — Windows installer/app icon. **Not committed** — drop a 256×256
  `.ico` here before running `npm run electron:build:win` to brand the
  installer. If missing, electron-builder falls back to its default.

## Data directory

The Electron main process sets `KBUILD_DATA_DIR=app.getPath('userData')` before
spawning the server, so `kb.db` and any other writable state land in the
per-user app data directory:

- Windows: `%APPDATA%\KBuild`
- macOS: `~/Library/Application Support/KBuild`
- Linux: `~/.config/KBuild`

The vault folder itself is user-selected in the UI and lives wherever the user
points it.

## Building installers

```bash
npm run electron:build:win     # Windows (NSIS .exe) — requires Windows host or Wine
npm run electron:build:mac     # macOS (DMG) — requires macOS host
npm run electron:build:linux   # Linux (AppImage)
```

`better-sqlite3` is a native module; electron-builder rebuilds it for
Electron's Node ABI automatically via `npmRebuild: true` in `package.json`'s
`build` config.

## Smoke-testing the Electron shell

```bash
npm run electron:dev
```

This builds the client + server bundle, then launches Electron pointing at the
local `dist/index.cjs`.
