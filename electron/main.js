const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

// This shell owns no business logic — it spawns the exact backend that
// `ragbuddy web` already runs and loads its dashboard in a native window.
// Anything changed in src/ or web/ shows up here automatically on the next
// build; nothing in this file needs to change alongside it.
//
// Dev (`electron .` from source) vs packaged paths differ: in dev, `dist/`
// sits at the repo root next to `node_modules/`. In a packaged build,
// electron-builder's `extraResources` puts the compiled backend at
// `resources/app/backend` — deliberately NOT `resources/dist`, because
// electron-builder silently drops anything named `dist` under `extraResources`
// (its own default output-folder exclusion glob) — and `resources/app/` is
// also exactly where electron-builder already bundles this project's own
// `node_modules`, so requiring `express`/`@qdrant/js-client-rest`/etc. from
// the packaged backend resolves the same way it does in dev (Node walks up
// from the requiring file looking for the nearest `node_modules`).
const REPO_ROOT = path.join(__dirname, '..');
const CLI_ENTRYPOINT = app.isPackaged
  ? path.join(process.resourcesPath, 'app', 'backend', 'cli', 'index.js')
  : path.join(REPO_ROOT, 'dist', 'cli', 'index.js');
const BACKEND_CWD = app.isPackaged ? path.join(process.resourcesPath, 'app') : REPO_ROOT;
const PORT = process.env.RAGBUDDY_PORT ? Number(process.env.RAGBUDDY_PORT) : 4300;
const READY_URL = `http://localhost:${PORT}/api/config`;
// Generous on purpose: a freshly-extracted portable .exe's first launch can be
// slow to spawn (e.g. Windows Defender scanning the newly-written backend
// files before letting it execute), well past a "normal" backend startup time.
const READY_TIMEOUT_MS = 30000;
const READY_POLL_INTERVAL_MS = 300;

let backend = null;
let backendExited = false;
let mainWindow = null;

function startBackend() {
  // Electron's own binary is not a plain `node` executable — ELECTRON_RUN_AS_NODE
  // tells it to behave like one, so the existing CLI runs unmodified without
  // requiring a separate Node.js install on the machine.
  backend = spawn(process.execPath, [CLI_ENTRYPOINT, 'web', '--port', String(PORT)], {
    cwd: BACKEND_CWD,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  backend.stdout.on('data', (chunk) => process.stdout.write(`[backend] ${chunk}`));
  backend.stderr.on('data', (chunk) => process.stderr.write(`[backend] ${chunk}`));
  backend.on('exit', () => {
    backendExited = true;
  });
}

/** Polls the real API instead of parsing stdout or waiting a fixed delay — the backend is
 *  "ready" exactly when it answers, whether that takes 200ms or several seconds. */
async function waitForBackend(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (backendExited) {
      throw new Error(
        'The RAGBuddy backend exited before it was ready. Check that the port is free and that the project has been built (`npm run build` at the repo root, `npm run build` in web/).',
      );
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not listening yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for the RAGBuddy backend at ${url}`);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'RAGBuddy',
    // Frameless: the web dashboard's own topbar (`AppShell`) renders the custom
    // titlebar — see `web/src/components/layout/window-controls.tsx` — instead
    // of the OS chrome, which would otherwise sit redundantly on top of it.
    frame: false,
    // Kept hidden until the page has actually finished laying out ('ready-to-show'
    // below) — showing immediately (Electron's default) lets the user see the
    // window mid-render (fonts/CSS/React still settling), which is what caused
    // the titlebar buttons to intermittently render mis-sized/offset and clicks
    // during that window to land on stale coordinates (e.g. the chat input not
    // taking focus).
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximized-changed', true));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximized-changed', false));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  await mainWindow.loadURL(`http://localhost:${PORT}`);
}

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

app.whenReady().then(async () => {
  startBackend();
  try {
    await waitForBackend(READY_URL, READY_TIMEOUT_MS);
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('RAGBuddy failed to start', error instanceof Error ? error.message : String(error));
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  backend?.kill();
});
