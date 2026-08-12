# Electron Desktop Shell

**Status: Implemented** — packaged build verified end-to-end (spawn, backend readiness, real HTTP
responses through the packaged app, clean shutdown).

## 1) What This Feature Is

A native desktop window for the existing web dashboard, for developers who'd rather double-click
an app than run `npm run web` and open a browser tab. It adds **no new application logic** — it
spawns the same backend `ragbuddy web` already runs and loads the same `web/dist` build in an
Electron `BrowserWindow`. Any change to `src/` or `web/` shows up here automatically on the next
build; nothing in this shell needs to change alongside application logic. It does add one small
piece of UI: a custom titlebar (see §4) replacing the OS chrome, since the dashboard already has
its own topbar and a second, native one on top of it would be redundant.

- Implementation: `electron/main.js`, `electron/preload.js`, `electron/package.json`,
  `web/src/components/layout/window-controls.tsx`, `web/src/lib/electron.ts`

## 2) Flow / Behavior

```
electron/main.js (app.whenReady)
  → spawn(<backend entrypoint> web --port 4300)  same backend as `ragbuddy web`
  → poll http://localhost:4300/api/config        until it answers (no fixed delay, no stdout parsing)
  → BrowserWindow.loadURL(http://localhost:4300)  same web/dist the browser would show
  → on quit: kill the spawned backend process
```

The backend entrypoint path branches on `app.isPackaged`: in dev (`electron .` from source) it's
`<repo-root>/dist/cli/index.js`, next to the repo's own `node_modules`. In a packaged build it's
`process.resourcesPath/app/backend/cli/index.js` — see §5 for why this is `app/backend`, not the
`resources/dist` a naive mirror of the dev path would suggest.

`main.js` uses `ELECTRON_RUN_AS_NODE=1` when spawning — Electron's own bundled binary is not a
plain `node` executable, and this env var tells it to behave like one, so the existing CLI runs
completely unmodified without requiring a separate Node.js install on the machine running the
packaged app.

Readiness is detected by polling the real `/api/config` endpoint rather than parsing the backend's
stdout or waiting a fixed timeout — the window opens exactly when the backend can actually serve
it, whether that takes 200ms or several seconds (e.g. a slow first Qdrant connection).

## 3) Domain & Data

No new persisted state of its own — but the packaged app's `dataDir`/registry/credential paths
must be pointed at the **same** absolute location as the dev install for it to feel like one
RAGBuddy, not a second empty one. `RAGBUDDY_DATA_DIR`, `PROJECT_REGISTRY_PATH`,
`CHAT_SETTINGS_PATH`, and `EMBEDDING_CREDENTIALS_PATH` in the repo root `.env` are set to absolute
paths (e.g. `D:/laragon/www/private/project-rag/data`) rather than the relative defaults — since
`.env` gets copied verbatim into the packaged app (`app/.env`), this makes the packaged app read
and write the *exact same* `sync-history.json`/`project-stats.json`/uploads/registered-projects as
the CLI and `ragbuddy web`, not an isolated copy. Without this, a fresh install shows an empty
Recent Activity chart and no registered projects beyond whatever was copied at build time — not a
bug, just two different data directories. (One consequence: `extraResources`' `../config` →
`app/config` copy is now dead weight — nothing reads from it once these paths are absolute — kept
for now since it's harmless, not worth the risk of removing without re-verifying.)

`electron/` is a fully separate, independent Node project (own
`package.json`, own `node_modules` — same pattern `web/` already uses, not an npm workspace) so
that neither the backend's `tsconfig.build.json` nor `web/`'s Vite build ever need to know it
exists.

## 4) UI

The window itself is frameless (`frame: false`) — no OS titlebar, no default Electron menu bar
(File/Edit/View/Window/Help). Instead, the dashboard's existing topbar (`AppShell`) doubles as the
titlebar:

- The topbar carries the `app-drag-region` CSS class (`-webkit-app-region: drag`, a no-op outside
  Electron, so this is applied unconditionally, not behind an `isElectron` check); every
  interactive element inside it (menu button, breadcrumb links, add-project button,
  `WindowControls`) carries `app-no-drag-region` so it stays clickable instead of dragging the
  window.
- `WindowControls` (`web/src/components/layout/window-controls.tsx`) renders minimize/
  maximize-restore/close buttons at the topbar's right edge, reading `window.electronAPI` (exposed
  by `electron/preload.js` via `contextBridge`, `undefined` in a normal browser tab) — it renders
  `null` when that API is absent, so the browser-served dashboard looks completely unchanged.
  Clicks go through `ipcRenderer.send('window:minimize'|'window:toggle-maximize'|'window:close')`
  to `main.js`'s `ipcMain` handlers; the maximize icon swaps to a restore icon via
  `mainWindow.on('maximize'|'unmaximize', ...)` pushed back to the renderer over IPC.
- Same right-aligned Windows-style control layout on every platform (no macOS left-aligned
  traffic-light convention) — a deliberate simplification, since this targets the Windows machine
  it was built on, not general cross-platform distribution (see §5).
- Otherwise: showing the exact same dashboard the browser would, at 1280×800 default — no other
  Electron-specific UI was built, matching the "no FE rewrite" goal.

## 5) Edge Cases & Rules

- **The backend port (default 4300) must be free.** If another `ragbuddy web` is already running
  on the same port, or the backend fails to start for any other reason, the poll loop detects the
  child process exiting and shows a `dialog.showErrorBox` instead of hanging.
- **`extraResources` destinations must avoid the literal name `dist`.** electron-builder silently
  drops any `extraResources` entry whose `to` is (or starts with) `dist` — it's excluded by
  electron-builder's own default output-folder glob (`!dist{,/**/*}`), which is normally meant to
  stop the app from packaging its own build artifacts into itself, but applies to *any* resource
  named `dist`, including a legitimately-wanted one. Symptom when this bites: the packaged app's
  spawned backend exits immediately (the entrypoint file doesn't exist), and the shell's own error
  dialog reports "the RAGBuddy backend exited before it was ready" — found and fixed live during
  this feature's own packaging test (see Verification). Fix: copy the compiled backend to
  `resources/app/backend` instead of `resources/dist`. This also had to stay a *sibling of*
  `resources/app/node_modules` (where electron-builder puts this project's own `dependencies` by
  default) — `resources/app/`, not the resources root — so Node's directory-walking `require()`
  resolution finds `express`/`@qdrant/js-client-rest`/etc. the same way it does in dev. `web/dist`,
  `.env`, and `config/` were moved under `app/` too, to preserve the same sibling relationship
  `dist/cli/index.js` already relies on relative to its own location (`../../web/dist`,
  `../../.env`, `../../config`) — unchanged from how `ragbuddy web` resolves these paths normally.
- **The `portable` Win target is slow to open — every single launch, not just the first.** It
  self-extracts its ~260MB (Electron + Chromium + `node_modules`, including native modules like
  `@napi-rs/canvas`) to a *new random* temp folder on every launch, so antivirus real-time scanning
  treats the files as unseen every time rather than building trust for a fixed install location —
  observed taking 5–7 minutes on a real run before the window appeared (`RAGBuddy 0.1.0.exe`,
  `Not Responding` for most of that time). `npm run pack` (`electron-builder --dir`, no compression
  step) produces `electron/dist/win-unpacked/RAGBuddy.exe` instead — no extraction step at all,
  since the files already sit in a fixed location — confirmed backend-reachable in **13 seconds**
  from a cold launch. Recommended for regular personal use; keep `npm run build` (portable) only
  for producing a single file to hand to someone else occasionally.
- **This targets a single already-configured RAGBuddy install**, not multi-user distribution — the
  packaged app would ship whatever `.env`/`config/*.json` exist on the machine it's built on. Not
  designed to hand this installer to someone else's machine as-is.
- **Custom titlebar is Windows-styled on every platform.** macOS conventionally puts
  close/minimize/maximize at the top-left as traffic lights; this shell always renders a
  right-aligned Windows-style trio instead. Acceptable for this single-developer use case, not a
  general cross-platform polish decision.
- **Frameless loses OS-drawn resize edges' visual affordance, not the behavior.** Electron keeps a
  frameless `BrowserWindow` resizable by dragging its edges by default (`resizable: true` is the
  default); double-click-to-maximize on the drag region is also Chromium's default behavior for an
  `app-drag-region` element — neither needed extra code, but neither has a visible cue that it's
  possible, since there is no OS-drawn border to hint at it.

## Verification

No automated test — this is a thin process-orchestration shell (spawn/poll/window/quit), not
business logic with a Vitest-friendly surface, and the repo's existing convention is to skip forced
tests for genuinely process-shaped code (see e.g. the Git hook feature). Verified instead, live
against real builds:

- **Spawn/poll/kill logic**, before installing Electron at all: a standalone Node script exercising
  the identical logic `main.js` uses (same spawn args, same polling function, same kill call)
  against the real built `dist/cli/index.js web` — confirmed the backend starts, becomes reachable,
  serves a real request, and is fully terminated after `kill()`.
- **A real packaged Windows build**, twice — first attempt caught the `extraResources`/`dist`-name
  bug (§5): the packaged app's own error dialog reported the exact failure, `resources/` was
  inspected directly and confirmed the backend folder was missing entirely. Second attempt (after
  the `app/backend` fix) confirmed via direct HTTP calls to the running packaged app:
  `GET /api/config` → 200 with the packaged app's real (temp-extracted or fixed, depending on
  target) paths reflected in the response (`cliEntrypoint`, `projectRegistryPath`), and
  `GET /api/projects` → 200 with all 6 real registered projects and their cached stats
  (`data/project-stats.json` cache-miss-then-recompute path — see
  [2026-08-11_dashboard-slow-project-list.md](../issue/2026-08-11_dashboard-slow-project-list.md) —
  worked correctly even though the packaged app's `data/` starts fresh/empty, since a project
  registered means its stats get recomputed once and cached from then on).
- **Icon**: `images/icon.png` (169×169) is below electron-builder's hard minimum (256×256,
  a build-time error, not just a warning) — upscaled to 512×512 via `System.Drawing` (PowerShell,
  no new dependency) into `electron/build/icon.png`, which builds clean.
- **`portable` vs `pack` (`--dir`) launch time** — see §5; measured directly (process state via
  `tasklist`/`Get-CimInstance Win32_Process`, HTTP polling with timestamps), not estimated.
- Frameless window + custom titlebar (drag region, minimize/maximize/close, restore-icon toggle)
  code paths are covered by `tsc -b`/`oxlint`/`vite build` (all clean) but the actual click/drag
  interactions have not been manually exercised one-by-one yet — the window itself is confirmed to
  render and serve the real dashboard.

## Related Files

- `electron/main.js` — the shell: spawn, poll, frameless window, IPC handlers for
  minimize/maximize/close, quit
- `electron/preload.js` — `contextBridge`-exposed `window.electronAPI`, the only bridge between the
  renderer and Electron's main process
- `electron/package.json` — `start`/`pack`/`build` scripts, `electron-builder` config
  (`extraResources` under `app/`, `icon: build/icon.png`)
- `electron/build/icon.png` — 512×512 upscale of `images/icon.png` (which is 169×169, below
  electron-builder's minimum)
- `web/src/components/layout/window-controls.tsx` — the custom titlebar buttons
- `web/src/lib/electron.ts` — `getElectronAPI()`, the `window.electronAPI` type
- `web/src/components/layout/app-shell.tsx` — topbar carries `app-drag-region` +
  `WindowControls`; every interactive child carries `app-no-drag-region`
- `web/src/index.css` — `.app-drag-region`/`.app-no-drag-region` utility classes
- `src/cli/index.ts` — the `web` command this shell spawns, unchanged
- `web/dist` — the build this shell loads, unchanged

## Cross-References

- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Tech stack: [../steering/tech-stack.md](../steering/tech-stack.md)
- Depends on: [07-web-frontend-and-project-cli.md](./07-web-frontend-and-project-cli.md) (the `ragbuddy web` server this shell spawns unmodified)
