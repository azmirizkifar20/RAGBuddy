# Dashboard Redesign, Document Uploads & Sync History

**Status: Implemented**. Extends [07-web-frontend-and-project-cli.md](./07-web-frontend-and-project-cli.md) — the v1 dashboard was two flat pages (dashboard + project detail) with no navigation chrome. This replaces it with a sidebar shell and adds three genuinely new capabilities: document uploads, sync history, and an explainer page for how the RAG pipeline works.

## 1) What This Feature Is

Four things, one release:

1. **Sidebar layout + redesign** — a persistent nav shell and a quiet, data-first visual language (dark mode, hairline surfaces, tables over card stacks), replacing the two unstyled pages.
2. **Document uploads** — upload PDF, Word, Excel, Markdown, CSV and plain-text files into a project's knowledge base without putting them in the Git repository.
3. **Sync history** — every ingest/sync/upload run is recorded and browsable per project, plus a cross-project activity feed.
4. **Two new pages** — per-project MCP setup instructions, and an interactive RAG flow explainer.

## 2) Flow / Behavior

### Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | `pages/dashboard.tsx` | Totals row, project grid (first 3 projects, "View all N projects →" to `/projects` beyond that), a 7-day **activity chart** (`components/activity-chart.tsx`, stacked by run kind, with a table-view toggle), then the cross-project **recent activity table** below it |
| `/projects` | `pages/projects.tsx` | Filterable project list |
| `/projects/:id` | `pages/project-layout.tsx` → `project-overview.tsx` | Stats, ingest/sync console, hook toggle, indexed paths |
| `/projects/:id/documents` | `project-documents.tsx` | Indexed-file browser (filter by source) + upload tab |
| `/projects/:id/search` | `project-search.tsx` | Same retrieval path an agent hits |
| `/projects/:id/history` | `project-history.tsx` | Run table + success/failure/duration stats |
| `/projects/:id/mcp` | `project-mcp.tsx` | Copy-pasteable MCP config for Claude Code / OpenCode / Codex |
| `/flow` | `rag-flow.tsx` | Three interactive pipeline diagrams |
| `/settings` | `settings.tsx` | Read-only runtime configuration |

`ProjectLayout` loads the project, its indexed documents and its uploads once, then hands them to every child tab via `Outlet` context — the tabs never re-fetch.

Navigation is deliberately single-level per surface: the sidebar lists workspace links and a flat list of projects, and **never expands a per-project sub-menu**. Once you are inside a project, its tab bar is the only project-level navigation.

### Upload flow

```
Browser file picker / drag-drop
  → FileReader → base64            (binary formats ride the same JSON endpoint)
  → POST /api/projects/:id/uploads   { filename, data }
  → assertSafeUploadName()           rejects paths, dotfiles, unsupported extensions
  → extractDocument()                PDF/DOCX/XLSX → Markdown-shaped text
  → chunkMarkdown → embedDocuments   same pipeline repository docs use
  → write ORIGINAL bytes to <dataDir>/uploads/<projectId>/<name>  (only after extract+embed succeeded)
  → delete old vectors for that file (if replacing) → upsert with source:'upload'
  → recordRun() writes a history entry
```

### Supported formats and how each is read

| Extensions | Read as | Library |
|------------|---------|---------|
| `.pdf` | One `## Page N` heading per page, so a hit cites a page | `pdf-parse` v2 (`PDFParse` class) |
| `.docx` | Markdown, keeping Word's heading levels | `mammoth` (`convertToMarkdown`) |
| `.xlsx`, `.xlsm` | `## <sheet>` heading + pipe rows per sheet | `exceljs` |
| `.md`, `.mdx`, `.markdown` | Passed through untouched | — |
| `.txt`, `.text`, `.log`, `.rst`, `.adoc`, `.json`, `.yaml`, `.yml`, `.csv`, `.tsv` | UTF-8 decoded | — |
| `.doc`, `.xls`, `.ppt`, `.pptx` | Rejected with a "save as .docx/.xlsx / export as PDF" hint rather than a generic error | — |

Everything is converted into **Markdown-shaped text on purpose**: the existing heading-aware chunker then splits a PDF by page, a Word file by its own headings, and a spreadsheet by sheet, with no special-casing downstream.

Parsers are loaded with `await import(...)` so `ragbuddy mcp` and `sync` never pay to load three document libraries they don't use.

**Uploads store the original bytes, not the extracted text.** The file is the source of truth and the text is derived, so `get_project_document` re-extracts on read — which also means a future parser improvement applies to already-uploaded documents. That is why `getProjectDocument` is now `async`.

### History flow

`recordRun(store, meta, run, summarize)` wraps every ingest/sync/upload call site — CLI, web routes, and (via the CLI) the git hook. It times the run, records success *and* failure, and re-throws so existing error handling is untouched. A failing history write is swallowed: observability must never break an ingest.

The git hook now exports `RAGBUDDY_TRIGGER=hook` before invoking the CLI, which is how the history page distinguishes an automatic sync from one you typed.

## 3) Domain & Data

Two new pieces of persisted state, both under `config.dataDir` (default `<install>/data`, overridable with `RAGBUDDY_DATA_DIR`, resolved against the install directory not `process.cwd()` — same rule as the project registry):

- `data/sync-history.json` — newest-first array of `RunRecord`, capped at 500 entries, rewritten whole on append. A corrupt file is treated as empty.
- `data/uploads/<projectId>/<filename>` — the uploaded documents themselves.

### `source` payload field

Qdrant points now carry `source: 'repository' | 'upload'`. This is what keeps uploads alive:

- `indexProject` deletes with scope `'repository'`, so a full re-index rebuilds repo docs without touching uploads.
- `syncProject` diffs against scope `'repository'`, so uploads (which have no file in the scan) are never reported as deleted.

**`'repository'` is expressed as `must_not source=upload`, not `must source=repository`** — points written before this feature existed have no `source` field at all, and a positive match would orphan every one of them (never diffed, never deleted, never cleaned up).

New `getIndexedFiles()` returns one row per file (`file`, `source`, `documentType`, `chunkCount`, `title`) off a single scroll, which the document browser and the project counts both use. `document_type` now carries the real format (`pdf`/`docx`/`xlsx`/…) instead of always saying `markdown`.

### New API surface

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/projects/:id/uploads` | List uploaded documents |
| `POST` | `/api/projects/:id/uploads` | `{ filename, data }` (base64) or `{ filename, content }` (UTF-8 text) → extract + index it |
| `DELETE` | `/api/projects/:id/uploads/:filename` | Delete file + vectors |
| `GET` | `/api/projects/:id/history?limit=` | Project-scoped run list |
| `GET` | `/api/activity?limit=` | Cross-project run feed |
| `GET` | `/api/config` | Runtime settings for the MCP/settings pages |

`GET /api/projects` and `/api/projects/:id` gained `chunkCount`, `uploadCount` and `lastRunAt`. `/api/projects/:id/knowledge` gained `documents` and `chunkCount` alongside the original `files`.

`express.json` limit raised to `32mb` — uploads travel base64-encoded inside JSON, so this limit (not the file picker) is the real ceiling on document size.

## 4) UI

See [../design-system/README.md](../design-system/README.md) for tokens, motion rules and component conventions. Summary: OKLCH token set with light+dark and a single violet accent used sparingly, hairline-bordered surfaces (no rings, glows or gradients), tables for tabular data, `lucide-react` icons used functionally rather than decoratively, `next-themes` (dark by default), one fade-up per page, `Skeleton` loading states, `EmptyState` for every empty list, and a global `prefers-reduced-motion` guard.

## 5) Edge Cases & Rules

- **Uploads never touch the user's repository.** They are stored in ragbuddy's own data dir. Removing a project from the registry does not delete them (consistent with the existing "removal only unregisters" behaviour).
- **Filenames are untrusted.** `assertSafeUploadName` rejects anything with a path component, a leading dot, unsupported characters, or an unsupported extension — before anything is read, written or embedded. Verified live against `../../../etc/passwd`, `uploads/../../package.json` and `uploads/../../../.env` through both the HTTP route and the MCP `get_project_document` tool.
- **A failed extract or embed writes nothing.** The file lands on disk only after both succeed, so there is never an orphan file that claims to be indexed.
- **A scanned PDF is rejected, not silently indexed.** A PDF with no text layer produces no body, and the error says to run OCR first. The synthetic `# <filename>` title is added *after* the empty check precisely so a title-only document can't masquerade as content — a test caught this.
- **Word images are stripped before chunking.** mammoth inlines embedded images as base64 data URIs; two photos in a real 7KB article expanded to 8.5MB of text that is pure noise to an embedding model.
- **Extraction is capped at 1,000,000 characters.** A large spreadsheet can flatten into millions of characters and thousands of embedding calls. Past the cap the text is cut, a `[Truncated: …]` marker is appended, and `truncated: true` comes back so the UI can say so — nothing is dropped silently.
- **Filenames are validated by what is dangerous, not by an ASCII allowlist.** The first version allowed only `[w .()-]`, which rejected `Ringkasan Proyék.docx`, `Laporan – Q1.pdf` (Word autocorrects a hyphen into an en dash), `data, final.xlsx`, `notes & ideas.md` and every non-Latin filename — 8 of 10 ordinary names. It now rejects path components, `..`, dotfiles, control characters, the Windows-illegal set `< > : " | ? *`, reserved device names (`CON`, `NUL`, `COM1`…), trailing dots/spaces, and names over 200 bytes.
- **Deleting an upload uses `unlinkSync`, never `fs.rmSync`.** On Windows, `fs.rmSync` returns successfully **without deleting anything** when the filename contains non-ASCII characters (reproduced on Node 24: `rmSync` left `Ringkasan Proyék.xlsx` in place every time, `unlinkSync` removed it). This only became reachable once non-ASCII filenames were allowed. `removeUpload` also re-checks that the file is gone afterwards and reports a clear error if it is not — a file locked by Word or Excel is the everyday case, and the dashboard must not claim a removal that did not happen.
- **Every Qdrant write passes `wait: true`.** Qdrant defaults to `wait=false`, acknowledging a write before the points are searchable. Without it, an upload returned indexed while a search issued immediately after still missed the document, and a delete reported success while the document was still being returned. Verified: with `wait: true`, a document uploaded and searched with zero delay comes back as the top hit.
- **Upload size ceiling is ~20MB.** Files travel base64-encoded inside JSON (~1.33x inflation) against a 32MB `express.json` limit; the browser checks the limit before reading the file.
- **Re-uploading the same filename replaces it** — old vectors are deleted first, and the response says `replaced: true`.
- **`GET /api/config` never returns the embedding API key**, only `embeddingApiKeyConfigured: boolean`.
- **Settings are read-only in the UI.** Config is loaded once at process start; editing it from the browser would silently not apply to the running server.
- **No automated frontend test suite** (unchanged from v1 — explicit YAGNI). Verified with `tsc -b && vite build`, `oxlint`, the 193-test backend suite, and a live end-to-end pass against the real Qdrant + embedding provider. Markdown: upload → retrieve (top hit, 0.81) → sync (`deleted: []`, upload survived) → full ingest (37 files re-embedded, upload survived) → MCP read → traversal blocked → delete. Binary formats: a real PDF (7 chunks), Word file (20 chunks — proving image stripping worked) and Excel workbook (2 chunks) uploaded through the running API, each retrieved by search with meaningful section labels (`Page 3`, the document's own Word heading, the sheet name `Result`), read back as text through MCP `get_project_document`, left untouched by a sync, then deleted — back to 37 docs / 420 chunks.

## Related Files

- `src/history/sync-history.ts` — `SyncHistoryStore`, `recordRun`
- `src/ingestion/document-extractor.ts` — `extractDocument`, `assertSupportedUploadExtension`, `stripDataUriImages`
- `src/ingestion/uploads.ts` — `assertSafeUploadName`, `uploadDocument`, `listUploads`, `removeUpload`
- `src/qdrant/qdrant-repository.ts` — `scopedFilter`, `getIndexedFiles`, scoped `getIndexedFileHashes`/`deleteProjectVectors`
- `src/server/routes/{uploads,history}.ts`, `src/server/app.ts` (`/api/config`, `/api/activity`, `RuntimeInfo`)
- `src/mcp/document-reader.ts` — `uploads/…` read path
- `src/git/hook-installer.ts` — `RAGBUDDY_TRIGGER=hook`
- `src/config/config.ts` — `dataDir`
- `web/src/components/layout/{app-shell,sidebar,page-header,theme-toggle}.tsx`
- `web/src/components/{stat-row,empty-state,run-table,upload-panel,flow-diagram,copy-button}.tsx`
- `src/qdrant/qdrant-repository.ts` — `wait: true` on every write
- `web/src/pages/{dashboard,projects,project-layout,project-overview,project-documents,project-search,project-history,project-mcp,rag-flow,settings}.tsx`
- `web/src/lib/{api-client,format,projects-context}.ts(x)`, `web/src/index.css`

## Cross-References

- Design system: [../design-system/README.md](../design-system/README.md)
- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- API conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
- Extends: [07-web-frontend-and-project-cli.md](./07-web-frontend-and-project-cli.md)
- Depends on: [02-ingestion-full-index.md](./02-ingestion-full-index.md), [03-incremental-sync.md](./03-incremental-sync.md), [05-mcp-server.md](./05-mcp-server.md), [06-git-hook-auto-sync.md](./06-git-hook-auto-sync.md)
