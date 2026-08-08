# API / Tool Conventions

`project-rag` has no HTTP REST API. Its two "API" surfaces are the **MCP tools** and the **CLI**. Conventions below are specified in [`../../init.md`](../../init.md) §14–§21; none are implemented yet.

## MCP Tool Conventions (planned)

- Every tool call MUST validate its parameters before use (`init.md` §21.10)
- `search_project_docs`: accepts `{ query, project? }` — if `project` is omitted, resolve from the caller's cwd against the registry; ambiguous/unresolvable cwd → explicit error, never a guess (`init.md` §15)
- `get_project_document`: accepts `{ file, project? }` — must reject path traversal (`../`) and any path resolving outside the registered repository (`init.md` §14, §21.3)
- `list_project_knowledge`: returns the indexed document list for the resolved project only
- Result shape for search: `{ file, section, score, content }` — concise, never dumping full documents (`init.md` §14)
- Do not expose unnecessary absolute filesystem paths in any MCP response (`init.md` §5, §21.9)

## Error Handling (planned)

- Invalid/ambiguous project resolution → explicit error, not a silent fallback (`init.md` §15)
- Path traversal or out-of-repo access attempts → rejected outright (`init.md` §21.3, §21.6)
- Git hook sync failures (Qdrant down, embedding provider down, project-rag unavailable) → logged as a warning, must never fail the underlying `git commit` (`init.md` §12)

## Naming & Routing

- CLI command tree and MCP tool names are fixed by spec (`init.md` §14, §18) — see [routing.md](./routing.md)
- No versioning scheme needed yet (single MCP server, no public HTTP surface)

## Auth & Permissions

- No authentication system in v1 — this is a local developer tool, not multi-user SaaS (`init.md` §27)
- Trust boundary is "only registered repositories/paths may be read" (`init.md` §21.1–21.2), enforced by the project registry + scanner, not by user auth

## Data Access

- All Qdrant reads/writes go through `src/qdrant/qdrant-repository.ts`; every query and write MUST include the `project` filter — project isolation is enforced at this layer, never left to the caller/LLM (`init.md` §6, §16, §21.7)
- Incremental writes follow the hash-diff cycle: unchanged → skip, changed → delete old chunks + reindex, deleted file → delete its vectors (`init.md` §9)
