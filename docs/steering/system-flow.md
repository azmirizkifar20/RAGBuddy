# System Flow

How the application will boot, initialize, and route requests at runtime. This is the starting point for tracing any feature end-to-end. **Status: planned** — traced from [`../../init.md`](../../init.md); no code exists yet, so paths below are the target layout, not existing files.

## Bootstrap & Entry Points (planned)

- **CLI entry**: `src/cli/` — parses `project-rag <command>` invocations (`init.md` §18)
- **MCP server entry**: `src/mcp/server.ts` — starts the MCP server for `project-rag mcp` (`init.md` §14)
- **Config load**: `src/config/config.ts` — reads `.env` + `PROJECT_REGISTRY_PATH` (`init.md` §19)

## Request Lifecycle — `sync` / `ingest` (planned)

1. CLI command (`project-rag sync <project>` / `project-rag ingest <project>`) → `src/cli/`
2. Validate project exists in registry → `src/projects/project-registry.ts`
3. Scan configured doc paths → `src/ingestion/scanner.ts`
4. Hash content, diff against previous state → `src/ingestion/hasher.ts`
5. Chunk changed/new markdown → `src/ingestion/chunker.ts`
6. Embed chunks → `src/embedding/embedding-provider.ts`
7. Upsert/delete vectors → `src/qdrant/qdrant-repository.ts`
8. Print summary (added/modified/deleted/unchanged) — `init.md` §10–11

## Request Lifecycle — MCP tool call (planned)

1. Agent (Claude Code / OpenCode / Codex) calls an MCP tool → `src/mcp/tools/*`
2. Resolve current project from cwd or explicit `project` param → `src/projects/project-registry.ts` (`init.md` §15)
3. Retrieval query enforces `project` filter before returning results → `src/retrieval/search.ts` + `src/qdrant/qdrant-repository.ts`
4. Response returned with file/section/score/content — no unnecessary absolute paths (`init.md` §5, §21)

## Background / Scheduled Flows (planned)

- Git `post-commit` hook (`.git/hooks/post-commit`) → shells out to `project-rag sync <project>` → must never block or fail the commit (`init.md` §12–13)

## Environment & Config (planned — `init.md` §19)

Required env vars (`.env.example`, to be created):
```
QDRANT_URL
QDRANT_COLLECTION
EMBEDDING_PROVIDER
EMBEDDING_BASE_URL
EMBEDDING_MODEL
EMBEDDING_API_KEY   # only if EMBEDDING_PROVIDER=openai
RAG_TOP_K
PROJECT_REGISTRY_PATH
```
