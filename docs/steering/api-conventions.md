# API / Tool Conventions

`project-rag` has no HTTP REST API. Its two "API" surfaces are the **MCP tools** and the **CLI**. Both are fully implemented; conventions below are specified in [`../../init.md`](../../init.md) §14–§21.

## MCP Tool Conventions (`src/mcp/tools/`)

- Every tool's `inputSchema` is a real Zod shape — the MCP SDK validates parameters before the handler runs (`init.md` §21.10)
- `get_project_context`: accepts `{ project? }` — returns identity, Git branch/commit/dirty state, README/steering-doc summaries (fixed well-known paths, truncated to ~800 chars each), and a documentation inventory; missing docs and an unavailable Qdrant/Git are omitted or flagged, never a thrown error — orientation only, never a substitute for `search_project_docs`
- `search_project_docs`: accepts `{ query, project? }` — if `project` is omitted, resolved from the caller's cwd against the registry via `src/projects/project-resolver.ts`; ambiguous/unresolvable cwd → explicit error, never a guess (`init.md` §15)
- `get_project_document`: accepts `{ file, project? }` — rejects path traversal (`../`) AND any path outside the project's configured `paths` (not just outside the repo — this is stricter than `init.md`'s literal wording, since a direct file read bypasses the ingestion scanner's own exclusion rules) (`init.md` §14, §21.3)
- `list_project_knowledge`: returns the indexed document list (from Qdrant's stored payloads) for the resolved project only
- Every tool wraps its handler in try/catch, returning `{ content: [...], isError: true }` on failure (`src/mcp/tool-result.ts`'s `toolError`) rather than throwing — a caught, protocol-valid error result, not a transport-level exception
- Result shape for search: `{ file, section, score, content }` — concise, one bounded chunk per result, never a full document (`init.md` §14)
- Do not expose unnecessary absolute filesystem paths in any MCP response (`init.md` §5, §21.9) — confirmed: none of the four tools' response shapes include `absolute_path`; `get_project_context` reports `repository.name` (basename only), never the resolved absolute repository path

## Error Handling

- Invalid/ambiguous project resolution → explicit error naming the conflicting project ids (or "no registered project"), never a silent fallback (`init.md` §15)
- Path traversal or out-of-repo/out-of-configured-paths access attempts → rejected outright, both in the ingestion scanner (`src/ingestion/scanner.ts`) and the MCP document reader (`src/mcp/document-reader.ts`) (`init.md` §21.3, §21.6)
- A registered repository that's moved/deleted/no-longer-a-Git-repo → `ingest`/`sync` throw a clear error before touching Qdrant, rather than silently treating "no files scanned" as "everything was deleted"
- Git hook sync failures (Qdrant down, embedding provider down, project-rag unavailable) → logged as a warning by the generated hook script, the underlying `git commit` always still succeeds (`init.md` §12)

## Naming & Routing

- CLI command tree and MCP tool names are fixed by spec (`init.md` §14, §18) — see [routing.md](./routing.md)
- No versioning scheme (single MCP server, no public HTTP surface)

## Auth & Permissions

- No authentication system (`init.md` §27) — this is a local developer tool, not multi-user SaaS
- Trust boundary is "only registered repositories/configured paths may be read" (`init.md` §21.1–21.2), enforced by the project registry + scanner + document reader, not by user auth

## Data Access

- All Qdrant reads/writes go through `src/qdrant/qdrant-repository.ts`; every query and write includes the `project` filter — project isolation is enforced at this layer, never left to the caller/LLM (`init.md` §6, §16, §21.7)
- Full rebuild (`indexer.ts`): delete-all-for-project, then upsert everything — a documented, deliberate tradeoff (a failure mid-run can leave the project's index empty rather than stale; a real atomic swap would need a run/version tag, noted as a future-phase concern, not implemented)
- Incremental sync (`sync.ts`): per-file delete-then-upsert, immediately, one file at a time — narrows any failure window to a single file rather than the whole batch
