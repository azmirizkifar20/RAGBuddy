# Dashboard Redesign, Document Uploads & Sync History

**Status: Implemented**. Extends [07-web-frontend-and-project-cli.md](./07-web-frontend-and-project-cli.md) — the v1 dashboard was two flat pages (dashboard + project detail) with no navigation chrome. This replaces it with a sidebar shell and adds three genuinely new capabilities: document uploads, sync history, and an explainer page for how the RAG pipeline works.

## 1) What This Feature Is

Four things, one release:

1. **Sidebar layout + redesign** — a persistent nav shell, dark mode, icons, and motion, replacing the two unstyled pages.
2. **Document uploads** — upload arbitrary `.md`/`.mdx`/`.txt` files into a project's knowledge base without putting them in the Git repository.
3. **Sync history** — every ingest/sync/upload run is recorded and browsable per project, plus a cross-project activity feed.
4. **Two new pages** — per-project MCP setup instructions, and an interactive RAG flow explainer.

## 2) Flow / Behavior

### Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | `pages/dashboard.tsx` | Totals, project grid, recent activity feed |
| `/projects` | `pages/projects.tsx` | Filterable project list |
| `/projects/:id` | `pages/project-layout.tsx` → `project-overview.tsx` | Stats, ingest/sync console, hook toggle, indexed paths |
| `/projects/:id/documents` | `project-documents.tsx` | Indexed-file browser (filter by source) + upload tab |
| `/projects/:id/search` | `project-search.tsx` | Same retrieval path an agent hits |
| `/projects/:id/history` | `project-history.tsx` | Run timeline + success/failure/duration stats |
| `/projects/:id/mcp` | `project-mcp.tsx` | Copy-pasteable MCP config for Claude Code / OpenCode / Codex |
| `/flow` | `rag-flow.tsx` | Three interactive pipeline diagrams |
| `/settings` | `settings.tsx` | Read-only runtime configuration |

`ProjectLayout` loads the project, its indexed documents and its uploads once, then hands them to every child tab via `Outlet` context — the tabs never re-fetch.

### Upload flow

```
Browser file picker / drag-drop
  → file.text()                      (text documents only, so no multipart is needed)
  → POST /api/projects/:id/uploads   { filename, content }
  → assertSafeUploadName()           rejects paths, dotfiles, unsupported extensions
  → chunkMarkdown → embedDocuments   same pipeline repository docs use
  → write file to <dataDir>/uploads/<projectId>/<name>   (only after embedding succeeded)
  → delete old vectors for that file (if replacing) → upsert with source:'upload'
  → recordRun() writes a history entry
```

### History flow

`recordRun(store, meta, run, summarize)` wraps every ingest/sync/upload call site — CLI, web routes, and (via the CLI) the git hook. It times the run, records success *and* failure, and re-throws so existing error handling is untouched. A failing history write is swallowed: observability must never break an ingest.

The git hook now exports `PROJECT_RAG_TRIGGER=hook` before invoking the CLI, which is how the history page distinguishes an automatic sync from one you typed.

## 3) Domain & Data

Two new pieces of persisted state, both under `config.dataDir` (default `<install>/data`, overridable with `PROJECT_RAG_DATA_DIR`, resolved against the install directory not `process.cwd()` — same rule as the project registry):

- `data/sync-history.json` — newest-first array of `RunRecord`, capped at 500 entries, rewritten whole on append. A corrupt file is treated as empty.
- `data/uploads/<projectId>/<filename>` — the uploaded documents themselves.

### `source` payload field

Qdrant points now carry `source: 'repository' | 'upload'`. This is what keeps uploads alive:

- `indexProject` deletes with scope `'repository'`, so a full re-index rebuilds repo docs without touching uploads.
- `syncProject` diffs against scope `'repository'`, so uploads (which have no file in the scan) are never reported as deleted.

**`'repository'` is expressed as `must_not source=upload`, not `must source=repository`** — points written before this feature existed have no `source` field at all, and a positive match would orphan every one of them (never diffed, never deleted, never cleaned up).

New `getIndexedFiles()` returns one row per file (`file`, `source`, `chunkCount`, `title`) off a single scroll, which the document browser and the project counts both use.

### New API surface

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/projects/:id/uploads` | List uploaded documents |
| `POST` | `/api/projects/:id/uploads` | `{ filename, content }` → index it |
| `DELETE` | `/api/projects/:id/uploads/:filename` | Delete file + vectors |
| `GET` | `/api/projects/:id/history?limit=` | Project-scoped run list |
| `GET` | `/api/activity?limit=` | Cross-project run feed |
| `GET` | `/api/config` | Runtime settings for the MCP/settings pages |

`GET /api/projects` and `/api/projects/:id` gained `chunkCount`, `uploadCount` and `lastRunAt`. `/api/projects/:id/knowledge` gained `documents` and `chunkCount` alongside the original `files`.

`express.json` limit raised to `10mb` — uploads travel as JSON, so the default 100kb was the real ceiling on document size.

## 4) UI

See [../design-system/README.md](../design-system/README.md) for tokens, motion rules and component conventions. Summary: violet/cyan OKLCH token set with light+dark, `lucide-react` icons, `next-themes` (dark by default), fade-up/stagger entry animations, `Skeleton` loading states, `EmptyState` for every empty list, and a global `prefers-reduced-motion` guard.

## 5) Edge Cases & Rules

- **Uploads never touch the user's repository.** They are stored in project-rag's own data dir. Removing a project from the registry does not delete them (consistent with the existing "removal only unregisters" behaviour).
- **Filenames are untrusted.** `assertSafeUploadName` rejects anything with a path component, a leading dot, unsupported characters, or an extension outside `.md/.mdx/.txt` — before anything is written or embedded. Verified live against `../../../etc/passwd`, `uploads/../../package.json` and `uploads/../../../.env` through both the HTTP route and the MCP `get_project_document` tool.
- **A failed embed writes nothing.** The file lands on disk only after embedding succeeds, so there is never an orphan file that claims to be indexed.
- **Re-uploading the same filename replaces it** — old vectors are deleted first, and the response says `replaced: true`.
- **`GET /api/config` never returns the embedding API key**, only `embeddingApiKeyConfigured: boolean`.
- **Settings are read-only in the UI.** Config is loaded once at process start; editing it from the browser would silently not apply to the running server.
- **No automated frontend test suite** (unchanged from v1 — explicit YAGNI). Verified with `tsc -b && vite build`, `oxlint`, the 193-test backend suite, and a live end-to-end pass against the real Qdrant + embedding provider: upload → retrieve (top hit, 0.81) → sync (`deleted: []`, upload survived) → full ingest (37 files re-embedded, upload survived, 38 docs / 422 chunks) → MCP read → traversal attempts blocked → delete → back to 37/420/0.

## Related Files

- `src/history/sync-history.ts` — `SyncHistoryStore`, `recordRun`
- `src/ingestion/uploads.ts` — `assertSafeUploadName`, `uploadDocument`, `listUploads`, `removeUpload`
- `src/qdrant/qdrant-repository.ts` — `scopedFilter`, `getIndexedFiles`, scoped `getIndexedFileHashes`/`deleteProjectVectors`
- `src/server/routes/{uploads,history}.ts`, `src/server/app.ts` (`/api/config`, `/api/activity`, `RuntimeInfo`)
- `src/mcp/document-reader.ts` — `uploads/…` read path
- `src/git/hook-installer.ts` — `PROJECT_RAG_TRIGGER=hook`
- `src/config/config.ts` — `dataDir`
- `web/src/components/layout/{app-shell,sidebar,page-header,theme-toggle}.tsx`
- `web/src/components/{stat-card,empty-state,run-list,upload-panel,flow-diagram,copy-button}.tsx`
- `web/src/pages/{dashboard,projects,project-layout,project-overview,project-documents,project-search,project-history,project-mcp,rag-flow,settings}.tsx`
- `web/src/lib/{api-client,format,projects-context}.ts(x)`, `web/src/index.css`

## Cross-References

- Design system: [../design-system/README.md](../design-system/README.md)
- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- API conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
- Extends: [07-web-frontend-and-project-cli.md](./07-web-frontend-and-project-cli.md)
- Depends on: [02-ingestion-full-index.md](./02-ingestion-full-index.md), [03-incremental-sync.md](./03-incremental-sync.md), [05-mcp-server.md](./05-mcp-server.md), [06-git-hook-auto-sync.md](./06-git-hook-auto-sync.md)
