# System Architecture

## Overview

`ragbuddy` indexes selected documentation (`docs/` by default) from multiple registered Git repositories into Qdrant, and exposes it to coding agents through an MCP server and a CLI. Git remains the source of truth; Qdrant is a rebuildable index. Full spec: [`../../init.md`](../../init.md).

## Architecture Diagram

```
Git Repository (project-a, project-b, ...)
        ↓ scan configured doc paths
   Ingestion (scanner → hasher → chunker)
        ↓
   Embedding Provider (Ollama / OpenAI-compatible)
        ↓
   Qdrant (ragbuddy_documents, payload-filtered by `project`)
        ↓
   Retrieval (project-filtered similarity search)
        ↓
   MCP Server  ←→  Claude Code / OpenCode / Codex
        ↑
       CLI (project / ingest / sync / search / hook / mcp / web)
        ↑
   Web (Express API + SSE)  ←→  web/ React SPA (Dashboard, Project Detail)
```

## Layers & Boundaries (`init.md` §4)

- **CLI layer**: `src/cli/{args,index,ingest-command,sync-command,sync-all-command,search-command,ask-command,hook-command}.ts` — argv parsing, per-command orchestration, calls into ingestion/retrieval/registry/hook-installer
- **Project management layer**: `src/projects/{project-registry,project-types,project-resolver}.ts` — registered repos, path config, project lookup (explicit id, or cwd-based resolution for MCP tools)
- **Ingestion layer**: `src/ingestion/{scanner,parser,chunker,hasher,payload-builder,indexer,sync}.ts` — scan → parse → chunk → hash; `indexer.ts` is the full-rebuild path, `sync.ts` is the incremental (hash-diff) path, both share `payload-builder.ts`'s chunk-payload/category helpers
- **Embedding layer**: `src/embedding/embedding-provider.ts` — provider-agnostic `embedDocuments`/`embedQuery` interface (Ollama, OpenAI-compatible)
- **Storage layer**: `src/qdrant/{qdrant-client,qdrant-repository}.ts` — all Qdrant reads/writes, project-filtered (`upsertChunks`, `deleteProjectVectors`, `deleteFileVectors`, `getIndexedFileHashes`, `searchPoints`)
- **Retrieval layer**: `src/retrieval/search.ts` — topK similarity search, enforces project filter before returning results; `src/retrieval/query-rewrite.ts`/`src/retrieval/hybrid-search.ts` (+`bm25.ts`/`bm25-index.ts`)/`src/retrieval/rerank.ts` — query rewriting, vector+BM25 hybrid search, and reranking on top of the same project-filtered search, chained by `src/retrieval/rag-context.ts` (`getRagResults`) and shared by the chat route and `ragbuddy ask`
- **Chat/completion layer**: `src/chat/complete-once.ts` — one shared blocking (non-streaming) LLM completion helper, used by the chat route's summarize/title generation and by the retrieval layer's query-rewrite/rerank, so retrieval never depends on `server/routes`
- **Git integration layer**: `src/git/{git-status,hook-installer,doc-staleness}.ts` — commit metadata, commit/merge/checkout auto-sync hook install/uninstall (chains safely with any pre-existing hook), and the doc-staleness heuristic (`commitsSince`/`isStale`)
- **MCP layer**: `src/mcp/{server,tool-result,document-reader}.ts`, `src/mcp/tools/{search-project-docs,get-project-document,list-project-knowledge}.ts` — the single MCP interface shared by all agents (no separate implementations per agent)
- **Config layer**: `src/config/config.ts` — env var loading/validation
- **Web layer**: `src/server/{app,sse}.ts`, `src/server/routes/{projects,knowledge,search,hook,ingest,sync,chat}.ts` — a third entry point (alongside CLI and MCP) exposing the same underlying modules over a REST API + SSE, serving the `web/` React SPA statically; started by `ragbuddy web`

Dependency direction: CLI and MCP are the two entry points; both call into project management → ingestion/retrieval → embedding/storage. Ingestion/retrieval/embedding/storage never depend on CLI or MCP.

## Key Components

| Component | Responsibility | Files |
|-----------|----------------|-----------|
| Project Registry | Register/list/remove/find projects (JSON-persisted) | `src/projects/project-registry.ts` |
| Project Resolver | Resolve project from cwd or explicit id, for MCP tools | `src/projects/project-resolver.ts` |
| Project Stats Cache | Cached per-project file/chunk/upload counts for the dashboard list, so `GET /api/projects` reads a small JSON file instead of scrolling every chunk out of Qdrant; refreshed by ingest/sync/upload | `src/projects/project-stats.ts` |
| Scanner | Walk configured doc paths, apply include/exclude rules, path-traversal-safe | `src/ingestion/scanner.ts` |
| Hasher | SHA-256 content hash per file for incremental sync | `src/ingestion/hasher.ts` |
| Parser / Chunker | Heading-aware markdown parsing + overlap-bounded chunking | `src/ingestion/{parser,chunker}.ts` |
| Indexer | Full-rebuild: scan → chunk → embed → delete-all → upsert | `src/ingestion/indexer.ts` |
| Sync | Incremental: hash-diff against Qdrant, only re-embed changed files, per-file delete-then-upsert | `src/ingestion/sync.ts` |
| EmbeddingProvider | Pluggable embedding backend (Ollama/OpenAI-compatible), concurrency-capped + timeout | `src/embedding/embedding-provider.ts` |
| Qdrant Repository | Project-filtered vector CRUD + search | `src/qdrant/qdrant-repository.ts` |
| Retrieval | topK search with mandatory project filter; `searchProjectMultiQuery` (chat-only) merges results across query variants | `src/retrieval/search.ts` |
| RAG Context | Shared rewrite → hybrid search → rerank pipeline behind every RAG-grounded answer (chat route, `ragbuddy ask`); never throws, a retrieval failure comes back as an `error` field instead | `src/retrieval/rag-context.ts` |
| Query Rewrite | LLM-generated alternative phrasings before retrieval, aware of recent conversation turns to resolve follow-up references, degrades to the original query on failure | `src/retrieval/query-rewrite.ts` |
| Hybrid Search | Fuses dense vector search with a lexical BM25 pass over the project corpus via Reciprocal Rank Fusion, degrades to vector-only on BM25 failure | `src/retrieval/hybrid-search.ts` |
| BM25 Index | Pure BM25 scoring + an in-memory per-project index cache, invalidated by the project's cached stats `updatedAt` | `src/retrieval/bm25.ts`, `src/retrieval/bm25-index.ts` |
| Rerank | LLM reorders a retrieval candidate pool by relevance before truncating to topK, degrades to the fused order on failure | `src/retrieval/rerank.ts` |
| Complete-Once | Shared blocking (non-streaming) LLM completion, used by chat summarize/title and by query-rewrite/rerank | `src/chat/complete-once.ts` |
| Document Reader | Path-traversal-safe, configured-path-scoped file read for MCP | `src/mcp/document-reader.ts` |
| MCP Tools | `get_project_context`, `search_project_docs`, `get_project_document`, `list_project_knowledge` | `src/mcp/tools/*` |
| Project Context Aggregator | Orientation-only context assembly: README/steering summaries + Git status + doc inventory, no vector search | `src/context/project-context.ts` |
| Hook Installer | Marker-delimited `post-commit`/`post-merge`/`post-checkout` hook install/uninstall, safe chaining | `src/git/hook-installer.ts` |
| Sync-All Command | Scheduled re-sync fallback: syncs every registered project in sequence, isolating per-project failures, meant to be cron-invoked | `src/cli/sync-all-command.ts` |
| Ask Command | One-shot RAG-grounded terminal answer via `getRagResults` + one blocking `completeOnce` call | `src/cli/ask-command.ts` |
| Chat Route | SSE streaming chat per project: auto-compaction (`CHAT_CONTEXT_LIMIT`), conditional RAG search, multimodal routing to the configured chat provider, client-abort via `res.on('close')`, plus the 👍/👎 feedback endpoint | `src/server/routes/chat.ts` |
| Chat Feedback Store | Persists 👍/👎 ratings on chat answers so failing queries are reviewable across sessions/devices | `src/history/chat-feedback.ts` |
| Doc Staleness | Route-level heuristic: flags a document once the repo has moved `STALE_COMMIT_THRESHOLD` commits past its indexed `git_commit` | `src/git/doc-staleness.ts` |

## Cross-Module Communication

- CLI and MCP call into the same underlying modules (project registry, retrieval, ingestion) — no duplicated logic between agent integrations (`init.md` §28)
- Git `post-commit`/`post-merge`/`post-checkout` hooks each shell out to the `ragbuddy sync <project>` CLI command; failures are caught and logged as warnings, never block the underlying Git operation (`init.md` §12)

## Data Flow

See [system-flow.md](./system-flow.md) for the full sync/ingest and MCP-call request lifecycles.

## Concurrency & Multi-Tenancy Notes

- Project isolation is enforced via Qdrant payload metadata (`project == "<id>"`), checked at the retrieval layer, not left to the LLM (`init.md` §6, §16, §21)
- Collection strategy starts as a single shared collection (`ragbuddy_documents`) with payload filtering; the retrieval layer is designed so a later move to per-project collections doesn't require a retrieval rewrite (`init.md` §6, §17)
