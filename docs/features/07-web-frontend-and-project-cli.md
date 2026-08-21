# Web Frontend & CLI Project Subcommands

**Status: Implemented**. Traced from `docs/superpowers/specs/2026-08-08-web-frontend-design.md` (a post-`init.md` feature — the CLI `project` subcommands were specified in `init.md` §18 but never built until now; the web dashboard is entirely new scope beyond `init.md`).

## 1) What This Feature Is

A visual layer over the exact same backend functions the CLI already uses (`ProjectRegistry`, `indexProject`, `syncProject`, `searchProject`, `installHook`/`uninstallHook`) — a small Express REST API plus a Vite/React SPA — served by a single new CLI command, `ragbuddy web`. Also fills the one gap left over from `init.md`: the `project register/list/remove` CLI subcommands.

- Spec: `docs/superpowers/specs/2026-08-08-web-frontend-design.md`; `init.md` §18 (CLI `project` subcommands)
- Implementation plans: `docs/superpowers/plans/2026-08-08-web-backend-api.md` (CLI subcommands + REST API), `docs/superpowers/plans/2026-08-08-web-frontend.md` (the `web/` SPA)

## 2) Flow / Behavior

```
ragbuddy project register/list/remove   → ProjectRegistry (same registry the rest of the CLI uses)
ragbuddy web [--port 4300]              → Express app: /api/* routes + landing page at / + serves web/dist at /dashboard/*
Landing (/)                              → static landing/index.html (see 14-landing-page.md)
Dashboard (/dashboard)                   → GET /api/projects → project cards, +Add Project modal
Project Detail (/dashboard/projects/:id) → GET /api/projects/:id, /knowledge → file list, search, ingest/sync log stream, hook toggle, remove
```

CLI subcommands (`src/cli/project-command.ts`, wired in `src/cli/index.ts`):
- `ragbuddy project register <id> <repository> --paths <p1,p2> [--name <name>]` — `--paths` is required (2026-08-20): registration is rejected without at least one path, see [01-project-registry-and-multi-project-support.md](./01-project-registry-and-multi-project-support.md#5-edge-cases--rules). The dashboard's Add Project modal enforces the same rule client-side (`paths` is a required field, no default).
- `ragbuddy project list`
- `ragbuddy project remove <id>`

REST API (`src/server/app.ts`, mounted at `/api/projects`):

| Method | Path | Wraps |
|--------|------|-------|
| `GET` | `/api/projects` | `ProjectRegistry.list()` + `getIndexedFileHashes` + `isHookInstalled` per project |
| `GET` | `/api/projects/:id` | Same per-project shape, single project |
| `POST` | `/api/projects` | `project-command.ts`'s register logic |
| `GET` | `/api/fs/roots` | Drive letters (Windows) or `/` (POSIX) plus the home directory — starting points for the folder picker |
| `GET` | `/api/fs/list?path=` | Subdirectories of an absolute path, each flagged `isGitRepo` — powers the Add Project 'Browse' dialog |
| `DELETE` | `/api/projects/:id` | `project-command.ts`'s remove logic |
| `GET` | `/api/projects/:id/knowledge` | `getIndexedFileHashes` — sorted indexed file list |
| `POST` | `/api/projects/:id/ingest` | `indexProject(..., { onLog })` — **SSE stream** |
| `POST` | `/api/projects/:id/sync` | `syncProject(..., { onLog })` — **SSE stream** |
| `POST` | `/api/projects/:id/search` | `searchProject` |
| `POST`/`DELETE` | `/api/projects/:id/hook` | `installHook`/`uninstallHook` |

All routes translate thrown `Error`s into `{ error: message }` + status code (404 not-found, 400 bad-input, 500 other) — no new error taxonomy.

## 3) Domain & Data

No new persisted data — the API is a thin read/write layer over the existing `ProjectRegistry` JSON file and Qdrant collection. `isHookInstalled(repositoryPath): boolean` (new export on `src/git/hook-installer.ts`) reads the real `.git/hooks/post-commit` file on every call rather than tracking cached state.

## 4) UI

- **Dashboard (`/dashboard`)** — `web/src/pages/dashboard.tsx`: grid of `ProjectCard`s (name, repo path, indexed-file count, auto-sync badge, one-click Sync), `+ Add Project` button opening `AddProjectModal`.
- **Project Detail (`/dashboard/projects/:id`)** — `web/src/pages/project-detail.tsx`: indexed-file list, `SearchPanel`, `LogStream` (live Ingest/Sync log streaming), `HookToggle`, `DeleteConfirmModal` (clarifies it only unregisters — no Qdrant/Git deletion).
- Built with Vite + React 19 + TypeScript, Tailwind CSS v4, shadcn/ui (Radix base, Nova preset), `sonner` toasts, `react-router` v8. The whole SPA sits under the `/dashboard` router basename (`/` is the landing page, `/login` the standalone login) — see [08](./08-dashboard-redesign-uploads-and-history.md) for the full route table.
- `web/src/lib/api-client.ts` is the single fetch/SSE layer every component uses — no component calls `fetch` directly.

## 5) Edge Cases & Rules

- **Repository folder picker**: `AddProjectModal`'s "Browse" button opens `FolderPicker`, which walks the server's filesystem via `GET /api/fs/roots` (drive letters on Windows / `/` on POSIX, plus the home directory) and `GET /api/fs/list?path=` (subdirectories of an absolute path, each flagged `isGitRepo`). This exists because the dashboard runs on the same machine as the process it's browsing — the trust model is unchanged (localhost, no auth, the CLI already accepts an arbitrary absolute path typed by hand); the picker only makes that easier, it doesn't expose anything new. Only directories are listed (never file contents), and dotfolders are hidden from the list but a `.git` folder is still detected to flag the parent as a repo.
- The ingest/sync SSE endpoints are triggered by `POST`, so the browser's native `EventSource` (GET-only, no body) can't consume them — `api-client.ts`'s `streamRun` parses the `event:`/`data:` wire format directly off a streamed `fetch` response body instead.
- Solo-user, localhost only by default — no authentication, matching the CLI's own trust model (`init.md` §27). Opt-in hardening for exposing the API beyond localhost: an API key generated/rotated/removed from the Settings page's "API access" section (`RAGBUDDY_API_KEY` only seeds it before first run), plus `RAGBUDDY_ALLOWED_ORIGINS` for CORS — see [12-external-web-app-integration.md](./12-external-web-app-integration.md#4-hardening-for-external-callers-optional).
- Nothing in `src/ingestion/`, `src/qdrant/`, `src/embedding/`, `src/retrieval/`, `src/mcp/`, or any existing CLI command (`ingest`/`sync`/`hook install`/`hook uninstall`/`search`/`mcp`) was modified by this feature — it only adds new callers on top of those, unchanged.
- No automated frontend test suite in v1 (explicit YAGNI) — verified via `npm run build` (TypeScript + Vite build) at every step, `oxlint`, and a live manual check of the full stack (`ragbuddy web` serving both the built SPA and the API together — confirmed `GET /`, a hashed JS asset, the SPA client-route fallback, and `GET /api/projects` all respond correctly). A real interactive browser click-through (register → sync → search → toggle hook → remove) was not performed — no browser automation tool was available in the implementing session; do a quick manual pass via `npm run dev` before considering this fully done.

## Related Files

- `src/git/hook-installer.ts` — `isHookInstalled` (new)
- `src/cli/project-command.ts` — `runProjectRegister`/`runProjectList`/`runProjectRemove`, shared by the CLI and the API
- `src/cli/args.ts`, `src/cli/index.ts` — `project` and `web` commands
- `src/server/app.ts`, `src/server/sse.ts`, `src/server/routes/{projects,knowledge,search,hook,ingest,sync,fs}.ts`
- `web/src/lib/api-client.ts` — REST + SSE client
- `web/src/components/{project-card,hook-toggle,delete-confirm-modal,add-project-modal,folder-picker,search-panel,log-stream}.tsx`
- `web/src/pages/{dashboard,project-detail}.tsx`, `web/src/App.tsx`
- Spec source: `docs/superpowers/specs/2026-08-08-web-frontend-design.md`

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- API conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
- Depends on: [01-project-registry-and-multi-project-support.md](./01-project-registry-and-multi-project-support.md), [02-ingestion-full-index.md](./02-ingestion-full-index.md), [03-incremental-sync.md](./03-incremental-sync.md), [04-retrieval-search.md](./04-retrieval-search.md), [06-git-hook-auto-sync.md](./06-git-hook-auto-sync.md)
