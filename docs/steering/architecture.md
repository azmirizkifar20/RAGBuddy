# System Architecture

## Overview

`project-rag` indexes selected documentation (`docs/` by default) from multiple registered Git repositories into Qdrant, and exposes it to coding agents through an MCP server and a CLI. Git remains the source of truth; Qdrant is a rebuildable index. Full spec: [`../../init.md`](../../init.md).

## Architecture Diagram

```
Git Repository (project-a, project-b, ...)
        ↓ scan configured doc paths
   Ingestion (scanner → hasher → chunker)
        ↓
   Embedding Provider (Ollama / OpenAI-compatible)
        ↓
   Qdrant (project_rag_documents, payload-filtered by `project`)
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

- **CLI layer**: `src/cli/{args,index,ingest-command,sync-command,search-command,hook-command}.ts` — argv parsing, per-command orchestration, calls into ingestion/retrieval/registry/hook-installer
- **Project management layer**: `src/projects/{project-registry,project-types,project-resolver}.ts` — registered repos, path config, project lookup (explicit id, or cwd-based resolution for MCP tools)
- **Ingestion layer**: `src/ingestion/{scanner,parser,chunker,hasher,payload-builder,indexer,sync}.ts` — scan → parse → chunk → hash; `indexer.ts` is the full-rebuild path, `sync.ts` is the incremental (hash-diff) path, both share `payload-builder.ts`'s chunk-payload/category helpers
- **Embedding layer**: `src/embedding/embedding-provider.ts` — provider-agnostic `embedDocuments`/`embedQuery` interface (Ollama, OpenAI-compatible)
- **Storage layer**: `src/qdrant/{qdrant-client,qdrant-repository}.ts` — all Qdrant reads/writes, project-filtered (`upsertChunks`, `deleteProjectVectors`, `deleteFileVectors`, `getIndexedFileHashes`, `searchPoints`)
- **Retrieval layer**: `src/retrieval/search.ts` — topK similarity search, enforces project filter before returning results
- **Git integration layer**: `src/git/{git-status,hook-installer}.ts` — commit metadata and post-commit hook install/uninstall (chains safely with any pre-existing hook)
- **MCP layer**: `src/mcp/{server,tool-result,document-reader}.ts`, `src/mcp/tools/{search-project-docs,get-project-document,list-project-knowledge}.ts` — the single MCP interface shared by all agents (no separate implementations per agent)
- **Config layer**: `src/config/config.ts` — env var loading/validation
- **Web layer**: `src/server/{app,sse}.ts`, `src/server/routes/{projects,knowledge,search,hook,ingest,sync}.ts` — a third entry point (alongside CLI and MCP) exposing the same underlying modules over a REST API + SSE, serving the `web/` React SPA statically; started by `project-rag web`

Dependency direction: CLI and MCP are the two entry points; both call into project management → ingestion/retrieval → embedding/storage. Ingestion/retrieval/embedding/storage never depend on CLI or MCP.

## Key Components

| Component | Responsibility | Files |
|-----------|----------------|-----------|
| Project Registry | Register/list/remove/find projects (JSON-persisted) | `src/projects/project-registry.ts` |
| Project Resolver | Resolve project from cwd or explicit id, for MCP tools | `src/projects/project-resolver.ts` |
| Scanner | Walk configured doc paths, apply include/exclude rules, path-traversal-safe | `src/ingestion/scanner.ts` |
| Hasher | SHA-256 content hash per file for incremental sync | `src/ingestion/hasher.ts` |
| Parser / Chunker | Heading-aware markdown parsing + overlap-bounded chunking | `src/ingestion/{parser,chunker}.ts` |
| Indexer | Full-rebuild: scan → chunk → embed → delete-all → upsert | `src/ingestion/indexer.ts` |
| Sync | Incremental: hash-diff against Qdrant, only re-embed changed files, per-file delete-then-upsert | `src/ingestion/sync.ts` |
| EmbeddingProvider | Pluggable embedding backend (Ollama/OpenAI-compatible), concurrency-capped + timeout | `src/embedding/embedding-provider.ts` |
| Qdrant Repository | Project-filtered vector CRUD + search | `src/qdrant/qdrant-repository.ts` |
| Retrieval | topK search with mandatory project filter | `src/retrieval/search.ts` |
| Document Reader | Path-traversal-safe, configured-path-scoped file read for MCP | `src/mcp/document-reader.ts` |
| MCP Tools | `search_project_docs`, `get_project_document`, `list_project_knowledge` | `src/mcp/tools/*` |
| Hook Installer | Marker-delimited `post-commit` hook install/uninstall, safe chaining | `src/git/hook-installer.ts` |

## Cross-Module Communication

- CLI and MCP call into the same underlying modules (project registry, retrieval, ingestion) — no duplicated logic between agent integrations (`init.md` §28)
- Git post-commit hook shells out to the `project-rag sync <project>` CLI command; failures are caught and logged as warnings, never block the commit (`init.md` §12)

## Data Flow

See [system-flow.md](./system-flow.md) for the full sync/ingest and MCP-call request lifecycles.

## Concurrency & Multi-Tenancy Notes

- Project isolation is enforced via Qdrant payload metadata (`project == "<id>"`), checked at the retrieval layer, not left to the LLM (`init.md` §6, §16, §21)
- Collection strategy starts as a single shared collection (`project_rag_documents`) with payload filtering; the retrieval layer is designed so a later move to per-project collections doesn't require a retrieval rewrite (`init.md` §6, §17)
