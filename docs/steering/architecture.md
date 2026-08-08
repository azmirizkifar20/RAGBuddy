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
       CLI (project / ingest / sync / search / hook / mcp)
```

## Layers & Boundaries (planned — `init.md` §4)

- **CLI layer**: `src/cli/` — command parsing, calls into ingestion/retrieval/registry
- **Project management layer**: `src/projects/project-registry.ts`, `src/projects/project-types.ts` — registered repos, path config, project resolution
- **Ingestion layer**: `src/ingestion/{scanner,parser,chunker,hasher,indexer}.ts` — scan → parse → chunk → hash → index
- **Embedding layer**: `src/embedding/embedding-provider.ts` — provider-agnostic `embedDocuments`/`embedQuery` interface
- **Storage layer**: `src/qdrant/{qdrant-client,qdrant-repository}.ts` — all Qdrant reads/writes, project-filtered
- **Retrieval layer**: `src/retrieval/search.ts` — topK similarity search, enforces project filter before returning results
- **Git integration layer**: `src/git/{git-status,git-diff}.ts` — commit metadata, hook installation
- **MCP layer**: `src/mcp/server.ts`, `src/mcp/tools/*` — the single MCP interface shared by all agents (no separate implementations per agent)

Dependency direction: CLI and MCP are the two entry points; both call into project management → ingestion/retrieval → embedding/storage. Ingestion/retrieval/embedding/storage never depend on CLI or MCP.

## Key Components

| Component | Responsibility | Planned Files |
|-----------|----------------|-----------|
| Project Registry | Register/list/remove/resolve projects | `src/projects/project-registry.ts` |
| Scanner | Walk configured doc paths, apply include/exclude rules | `src/ingestion/scanner.ts` |
| Hasher | SHA-256 content hash per file for incremental sync | `src/ingestion/hasher.ts` |
| Chunker | Structure-aware Markdown chunking (heading-preserving) | `src/ingestion/chunker.ts` |
| Indexer | Orchestrates chunk → embed → upsert/delete | `src/ingestion/indexer.ts` |
| EmbeddingProvider | Pluggable embedding backend (Ollama/OpenAI-compatible) | `src/embedding/embedding-provider.ts` |
| Qdrant Repository | Project-filtered vector CRUD | `src/qdrant/qdrant-repository.ts` |
| Retrieval | topK search with mandatory project filter | `src/retrieval/search.ts` |
| MCP Tools | `search_project_docs`, `get_project_document`, `list_project_knowledge` | `src/mcp/tools/*` |

## Cross-Module Communication

- CLI and MCP call into the same underlying modules (project registry, retrieval, ingestion) — no duplicated logic between agent integrations (`init.md` §28)
- Git post-commit hook shells out to the `project-rag sync <project>` CLI command; failures are caught and logged as warnings, never block the commit (`init.md` §12)

## Data Flow

See [system-flow.md](./system-flow.md) for the full sync/ingest and MCP-call request lifecycles.

## Concurrency & Multi-Tenancy Notes

- Project isolation is enforced via Qdrant payload metadata (`project == "<id>"`), checked at the retrieval layer, not left to the LLM (`init.md` §6, §16, §21)
- Collection strategy starts as a single shared collection (`project_rag_documents`) with payload filtering; the retrieval layer is designed so a later move to per-project collections doesn't require a retrieval rewrite (`init.md` §6, §17)
