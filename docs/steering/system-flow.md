# System Flow

How the application boots, initializes, and routes requests at runtime. This is the starting point for tracing any feature end-to-end. All paths below are real, implemented files.

## Bootstrap & Entry Points

- **CLI entry**: `src/cli/index.ts` — parses `process.argv` via `src/cli/args.ts`, constructs shared deps (config, registry, Qdrant client, embedding provider), dispatches to the matched command
- **MCP server entry**: `src/mcp/server.ts`'s `createMcpServer` — assembles an `McpServer` and registers all four tools; `src/cli/index.ts`'s `mcp` branch connects it over `StdioServerTransport`
- **Config load**: `src/config/config.ts`'s `loadConfig` — reads and validates required env vars, applies defaults

## Request Lifecycle — `sync` / `ingest`

1. CLI command (`project-rag sync <project>` / `project-rag ingest <project>`) → `src/cli/index.ts` → `src/cli/{sync,ingest}-command.ts`
2. Validate project exists in registry → `src/projects/project-registry.ts`
3. Validate the registered repository still exists and is a Git repo (guards against a moved/deleted path silently wiping the index) → `src/ingestion/{indexer,sync}.ts`
4. Scan configured doc paths → `src/ingestion/scanner.ts`
5. Hash content → `src/ingestion/hasher.ts`; for `sync`, compare against hashes already stored in Qdrant (`src/qdrant/qdrant-repository.ts`'s `getIndexedFileHashes`) to classify added/modified/deleted/unchanged
6. Chunk changed/new markdown (heading-aware) → `src/ingestion/{parser,chunker}.ts`
7. Embed chunks → `src/embedding/embedding-provider.ts`
8. Delete obsolete vectors, then upsert new ones → `src/qdrant/qdrant-repository.ts` (`ingest`: project-wide delete-then-upsert; `sync`: per-file delete-then-upsert, immediately, to narrow the failure window to a single file)
9. Print progress (`[INFO]` lines) and a final summary

## Request Lifecycle — MCP tool call

1. Agent (Claude Code / OpenCode / Codex) calls an MCP tool → `src/mcp/tools/*`
2. Resolve project from cwd or explicit `project` param → `src/projects/project-resolver.ts` (`init.md` §15) — ambiguous or unresolvable cwd is a hard error, never a guess
3. `get_project_context`: orientation-only, no vector search — direct-reads a handful of well-known docs (`README.md`, `docs/steering/*.md`) plus Git branch/commit/dirty state and a documentation inventory (`src/qdrant/qdrant-repository.ts`'s `getIndexedFiles`) → `src/context/project-context.ts`'s `buildProjectContext`; a Qdrant outage degrades the inventory to zero counts rather than failing the whole call
4. `search_project_docs`: embed the query, retrieval query enforces `project` filter before returning results → `src/retrieval/search.ts` + `src/qdrant/qdrant-repository.ts`'s `searchPoints`
5. `get_project_document`: read the file directly off disk, rejecting path traversal AND anything outside the project's configured doc paths → `src/mcp/document-reader.ts`
6. `list_project_knowledge`: list the files currently indexed in Qdrant for the project → `src/qdrant/qdrant-repository.ts`'s `getIndexedFileHashes`
7. Response returned with file/section/score/content — no unnecessary absolute paths (`init.md` §5, §21)

## Background / Scheduled Flows

- Git `post-commit` hook (`.git/hooks/post-commit`, installed by `project-rag hook install <project>` via `src/git/hook-installer.ts`) → shells out to `project-rag sync <project>` using the exact `node` binary and `dist/cli/index.js` path of the installation that ran `hook install` → always exits 0 regardless of sync success, printing a warning on failure — never blocks the commit (`init.md` §12–13)

## Environment & Config

Required/optional env vars (`.env.example`, `src/config/config.ts`):
```
QDRANT_URL                # required
QDRANT_COLLECTION         # optional, default project_rag_documents
EMBEDDING_PROVIDER        # required, "ollama" | "openai"
EMBEDDING_BASE_URL        # optional, defaults per provider (localhost:11434 / api.openai.com)
EMBEDDING_MODEL           # required
EMBEDDING_API_KEY         # optional, only meaningful for openai
RAG_TOP_K                 # optional, default 5
PROJECT_REGISTRY_PATH     # optional, default ./config/projects.json
```
