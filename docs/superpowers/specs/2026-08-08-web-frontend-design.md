# Web Frontend + CLI Project Subcommands — Design Spec

## Motivation

`project-rag` today is CLI + MCP only. Managing projects means hand-editing `config/projects.json`, and there's no way to see indexed state, browse files, or test search without the terminal. This adds:

1. **CLI `project` subcommands** (`register`/`list`/`remove`) — specified in `init.md` §18 but never built; the registry is currently JSON-only.
2. **A web dashboard** — a visual layer over the exact same underlying functions the CLI already uses (`ProjectRegistry`, `indexProject`, `syncProject`, `searchProject`, `installHook`/`uninstallHook`), with zero duplicated logic.

## Scope & Constraints

- **Users:** solo operator, localhost only. No authentication, no session management, no multi-user concerns — same trust model as the CLI today (whoever can reach the machine can use it).
- **Must not break existing behavior:** `sync`/`ingest`/`hook install`/`hook uninstall`/`search`/`mcp` CLI commands and the installed Git hook keep working exactly as they do today. Nothing in this spec modifies `src/ingestion/`, `src/qdrant/`, `src/embedding/`, `src/retrieval/`, `src/mcp/`, or `src/git/hook-installer.ts` — it only adds new callers on top of them.
- **Out of scope for v1** (explicit YAGNI, not deferred-and-forgotten): authentication, multi-user support, separate/remote deployment of the API vs. frontend, automated frontend tests, a `--json` output mode for the CLI.

## Architecture

**Single Node process, single new CLI command.** `project-rag web [--port 4300]` starts an Express server that (a) exposes a small REST API wrapping existing backend functions, and (b) serves the built Vite/React frontend as static files. One port, one command — the same operational simplicity as `project-rag mcp`.

```
src/
├── server/
│   ├── app.ts              # Express app: mounts routes, serves web/dist statically
│   ├── routes/
│   │   ├── projects.ts     # GET/POST /api/projects, GET/DELETE /api/projects/:id
│   │   ├── ingest.ts       # POST /api/projects/:id/ingest (SSE)
│   │   ├── sync.ts         # POST /api/projects/:id/sync (SSE)
│   │   ├── search.ts       # POST /api/projects/:id/search
│   │   ├── knowledge.ts    # GET /api/projects/:id/knowledge
│   │   └── hook.ts         # POST/DELETE /api/projects/:id/hook
│   └── sse.ts               # small helper to format/send SSE events
├── cli/
│   ├── project-command.ts  # runProjectCommand: register/list/remove — new shared logic
│   └── index.ts             # + `web` command dispatch, + `project` command dispatch

web/                          # separate Vite + React project (own package.json/vite.config.ts)
├── src/
│   ├── pages/Dashboard.tsx
│   ├── pages/ProjectDetail.tsx
│   ├── components/          # ProjectCard, AddProjectModal, DeleteConfirmModal, SearchPanel, LogStream, HookToggle
│   └── api-client.ts        # fetch wrapper for /api/*
├── index.html
└── vite.config.ts
```

**Key principle:** every `src/server/routes/*.ts` file is a thin wrapper — it calls `indexProject`/`syncProject`/`searchProject`/`ProjectRegistry`/`installHook`/`uninstallHook` directly, the same way `src/cli/*-command.ts` already does. The only genuinely new backend logic is (a) `project-command.ts` (register/list/remove), written once and shared by both the CLI (`project-rag project register ...`) and the API route (`POST /api/projects`), and (b) one new small function, `isHookInstalled(repositoryPath): boolean`, added to the existing `src/git/hook-installer.ts` (it just checks whether `.git/hooks/post-commit` contains that file's existing `MARKER_START` constant — no new state to track, it reads the real, current hook file every time it's called).

`web/` is a separate Vite project (its own toolchain) so React/JSX tooling doesn't mix into the backend's `tsconfig.build.json`. `npm run build` in `web/` produces `web/dist`, which `src/server/app.ts` serves as static files — so `project-rag web` in production only needs the built assets, not a running Vite dev server.

**Frontend stack:** Vite + React (SPA), Tailwind CSS for styling, shadcn/ui (Radix-based) for buttons/modals/toasts/badges — chosen so the UI is visually consistent and polished without hand-rolling CSS or a component library from scratch.

## CLI: `project` Subcommands (`init.md` §18)

New `src/cli/project-command.ts`, mirroring the existing `*-command.ts` pattern:

| Command | Behavior |
|---------|----------|
| `project-rag project register <id> <repository> [--name <name>] [--paths <p1,p2>]` | `ProjectRegistry.register()` — same validation as today (repo exists, is a Git repo, id not already taken) |
| `project-rag project list` | Print each registered project: id, name, repository, paths |
| `project-rag project remove <id>` | `ProjectRegistry.remove()` — unregisters only, does not touch Qdrant vectors or the Git repo |

`src/cli/args.ts` gains a `project` command with `register`/`list`/`remove` sub-actions, following the same `hook install`/`hook uninstall` two-level pattern already in place.

## API Endpoints

| Method | Path | Wraps | Notes |
|--------|------|-------|-------|
| `GET` | `/api/projects` | `ProjectRegistry.list()` + `getIndexedFileHashes` + `isHookInstalled` per project | Returns id/name/repository/paths/indexed-file-count/`hookInstalled` per project |
| `GET` | `/api/projects/:id` | `ProjectRegistry.find()` + `getIndexedFileHashes` + `isHookInstalled` | Same per-project shape as above, single project — backs the Project Detail page |
| `POST` | `/api/projects` | `project-command.ts`'s register logic | Body: `{ id, name?, repository, paths? }` |
| `DELETE` | `/api/projects/:id` | `project-command.ts`'s remove logic | Unregisters only |
| `GET` | `/api/projects/:id/knowledge` | `getIndexedFileHashes` | List of indexed relative file paths |
| `POST` | `/api/projects/:id/ingest` | `indexProject(..., { onLog })` | **SSE stream** — see Data Flow |
| `POST` | `/api/projects/:id/sync` | `syncProject(..., { onLog })` | **SSE stream** — see Data Flow |
| `POST` | `/api/projects/:id/search` | `searchProject` | Body: `{ query }`, returns `SearchResult[]` |
| `POST` | `/api/projects/:id/hook` | `installHook` | Installs the post-commit hook |
| `DELETE` | `/api/projects/:id/hook` | `uninstallHook` | Removes it |

Errors from the wrapped functions (project not found, invalid repo, path traversal, etc.) are caught and returned as `{ error: message }` with an appropriate status (404 not-found, 400 bad-input, 500 other) — no new error taxonomy, just a thin translation of the `Error`s these functions already throw.

## UI: Pages & Components

**1. Dashboard (`/`)** — grid of project cards: name, truncated repo path, indexed-file count, an "auto-sync hook" badge reflecting `hookInstalled` from `GET /api/projects` (a real read of the hook file, not an assumed/cached state), a one-click "Sync" action per card, and an "+ Add Project" button opening a modal (id/name/repository/paths, server-validated, field-level error messages). Clicking a card navigates to its detail page.

**2. Project Detail (`/projects/:id`)** — loads from `GET /api/projects/:id`; three areas: (a) a left panel listing indexed files (from `/knowledge`), (b) a search box + results panel showing score/file/section/content, matching the CLI's `search` output but easier to scan, (c) a bottom log panel: "Ingest" and "Sync" buttons that switch this area into a terminal-style view streaming `[INFO]` lines live via SSE, ending with the same summary the CLI prints (added/modified/deleted/unchanged, or files/chunks indexed). A toggle reflects and controls the auto-sync Git hook (initial state from `hookInstalled`, calls `POST`/`DELETE /hook` on flip, then re-reads the real state — never optimistic); a "Remove project" button (with a confirmation modal clarifying this only unregisters — it does not delete Qdrant vectors or the Git repository) sits in the corner.

**3. Confirmation modal** — shared component for the delete-project action, explicit about what is and isn't deleted.

**Interaction/polish:** clear loading states on Sync/Ingest buttons while streaming, toast notifications on success/failure, and a smooth transition when the log panel appears (not an abrupt show/hide) — per the "interactive, tidy layout" requirement.

## Data Flow — Live Log Streaming (Ingest/Sync)

1. Frontend opens an SSE connection to `POST /api/projects/:id/sync` (or `/ingest`).
2. The route calls `syncProject(project, { ...deps, onLog: (msg) => sendEvent('log', msg) })` — the existing `onLog` callback (already present since Phase 2/3) is wired straight to the SSE writer; no changes needed in `src/ingestion/`.
3. On success, a final `done` event carries the summary object (same shape `runSyncCommand`/`runIngestCommand` already return); the connection closes.
4. On a thrown error, an `error` event carries the message; the connection closes.
5. The frontend keeps the log panel visible after `done`/`error` (it doesn't auto-dismiss) until the user navigates away or starts another run.

## Error Handling

- **API layer:** every route wrapped in try/catch, translating thrown `Error`s into `{ error: message }` + status code — no new error types.
- **SSE layer:** mid-stream errors become an `error` event, not an HTTP error (the connection is already open as SSE).
- **Frontend:** the Add Project form surfaces the API's error message next to the relevant field (e.g. "Repository path does not exist" under the path input), not just a generic toast. Client-side validation is required-field-only for snappy UX; `ProjectRegistry.register()` remains the actual source of truth for validity.

## Testing

- **`project-command.ts`:** unit tests mocking `ProjectRegistry`, mirroring `hook-command.ts`/`ingest-command.ts`'s existing test pattern.
- **API routes:** unit tests using `supertest` against the Express app, with `ProjectRegistry`/Qdrant client/embedding provider mocked the same way CLI command tests already mock them; assert status codes and response bodies.
- **SSE endpoint:** one test collecting all emitted events from the response stream, asserting the `log*` → `done`/`error` event sequence.
- **Frontend:** no automated suite in v1 (YAGNI for a solo tool) — verified manually via `npm run dev` in `web/`, the same "run and look at it" verification pattern used throughout this project's CLI phases. Vitest + Testing Library can be added later if it proves worth it.

## Non-Goals (explicit)

- Authentication / multi-user access control
- Remote or split deployment of API vs. frontend
- A `--json` output mode for the CLI
- Automated frontend tests in v1
- Any change to `sync`/`ingest`/`hook install`/`hook uninstall`/`search`/`mcp` CLI behavior — this spec only adds new callers on top of existing, unmodified functions
