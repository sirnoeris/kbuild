// Electron main process — spawns the bundled Express server as a child
// process and loads its URL in a BrowserWindow. kb.db and any writable
// state land in app.getPath('userData') via KBUILD_DATA_DIR.
const { app, BrowserWindow, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const PORT = process.env.PORT || "3131";
const SERVER_URL = `http://127.0.0.1:${PORT}`;

let mainWindow = null;
let serverProcess = null;

function resolveServerPath() {
  // In a packaged app, electron-builder places the app at
  // resources/app (when asar is disabled for the `app` dir) — we ship
  // the server CJS under `dist/index.cjs` inside the app root.
  // In dev (npm run electron:dev) __dirname is <repo>/electron, so go up one.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app", "dist", "index.cjs");
  }
  return path.join(__dirname, "..", "dist", "index.cjs");
}

function startServer() {
  const serverPath = resolveServerPath();
  const userData = app.getPath("userData");

  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: userData,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT,
      HOST: "127.0.0.1",
      KBUILD_DATA_DIR: userData,
      // Electron sets ELECTRON_RUN_AS_NODE=1 to run as plain Node when
      // spawning process.execPath with a script argument.
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  serverProcess.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on("exit", (code) => {
    console.log(`[server] exited with code ${code}`);
    serverProcess = null;
  });
}

function waitForServer(url, retries = 60) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        tries += 1;
        if (tries >= retries) return reject(new Error("Server did not start"));
        setTimeout(tick, 500);
      });
    };
    tick();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "KBuild",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Open external links in the user's default browser instead of new windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(SERVER_URL);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  startServer();
  try {
    await waitForServer(SERVER_URL);
  } catch (err) {
    console.error("Server failed to start:", err);
    app.quit();
    return;
  }
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
