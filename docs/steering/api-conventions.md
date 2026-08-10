# API / Tool Conventions

`ragbuddy` has three API surfaces: the **MCP tools**, the **CLI**, and the **web HTTP API** (REST + SSE, serving the `web/` React dashboard). The MCP and CLI are fully implemented; the HTTP layer is added by the web features. Conventions below are specified in [`../../init.md`](../../init.md) §14–§21.

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
- Git hook sync failures (Qdrant down, embedding provider down, ragbuddy unavailable) → logged as a warning by the generated hook script, the underlying `git commit` always still succeeds (`init.md` §12)

## Web HTTP + SSE Conventions (`src/server/`)

- The web API is REST over `/api/...` plus SSE for streaming endpoints; JSON bodies for POST/DELETE, `application/json` responses
- SSE transport lives in `src/server/sse.ts`: `startSse(res)` sets `text/event-stream` + flushes headers; `sendSseEvent(res, event, data)` writes `event: <name>\ndata: <json>\n\n`
- **Chat stream contract** (`POST /api/projects/:id/chat`): the server emits, in order, `event: token` (`data: {text}`) as the provider streams, then `event: sources` (`data: {sources: [{file, section, score}], ragError?: string}`) when RAG is on, then `event: done` (`data: {}`). Any failure emits `event: error` (`data: {message}`) before `res.end()`. `ragError` is set only when retrieval itself throws (e.g. an embedding-model/vector-size mismatch after switching `EMBEDDING_MODEL` without re-ingesting) — never for "ran fine, found nothing relevant," which stays silent as a normal outcome. The chat still answers (without project context) either way; `ragError` exists so a config problem is visible instead of looking like an ordinary context-free answer.
- Chat request body: `{ messages: Array<{role, content}>, useRag?: boolean }`; `content` may be a string or an array of `{type: 'text'|'image_url'}` parts for multimodal
- Chat auto-compaction: when `messages.length > CHAT_CONTEXT_LIMIT`, older messages are summarized via the chat provider and prepended as a system context message; the newest `CHAT_CONTEXT_LIMIT` are kept verbatim
- Abort: the client may abort the stream; the server stops the upstream provider fetch via `res.on('close')` guarded by `!res.writableEnded` (`src/server/routes/chat.ts`)
- Chat is per-project: the `project` filter is applied at the retrieval layer, consistent with the search/MCP isolation rule below
- **Chat provider settings** (`GET`/`PUT /api/settings/chat`, `POST /api/settings/chat/test`) — not project-scoped, mounted at `/api/settings` separate from `/api/projects/:id/...`. Chat's provider/base URL/model/API key are independent of the embedding provider and live in `config/chat-settings.json`, re-read from disk on every request rather than cached at process start, so a save takes effect immediately with no server restart. API key convention: write-only — accepted in `PUT`/`.../test` bodies, never present in any `GET` response (`apiKeyConfigured: boolean` only, same pattern as the embedding API key's `embeddingApiKeyConfigured`); a blank/omitted key on save keeps whatever is already stored rather than clearing it. See [../features/10-chat-provider-settings.md](../features/10-chat-provider-settings.md).

## Naming & Routing

- CLI command tree and MCP tool names are fixed by spec (`init.md` §14, §18) — see [routing.md](./routing.md)
- No versioning scheme (single running version) — this is a local developer tool, not multi-user SaaS

## Trust Boundary

- Trust boundary is "only registered repositories/configured paths may be read" (`init.md` §21.1–21.2), enforced by the project registry + scanner + document reader, not by user auth

## Data Access

- All Qdrant reads/writes go through `src/qdrant/qdrant-repository.ts`; every query and write includes the `project` filter — project isolation is enforced at this layer, never left to the caller/LLM (`init.md` §6, §16, §21.7)
- Full rebuild (`indexer.ts`): delete-all-for-project, then upsert everything — a documented, deliberate tradeoff (a failure mid-run can leave the project's index empty rather than stale; a real atomic swap would need a run/version tag, noted as a future-phase concern, not implemented)
- Incremental sync (`sync.ts`): per-file delete-then-upsert, immediately, one file at a time — narrows any failure window to a single file rather than the whole batch