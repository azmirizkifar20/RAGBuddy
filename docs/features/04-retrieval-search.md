# Retrieval / Search

**Status: Planned** (Phase 4 — Retrieval). Not yet implemented; traced from [`../../init.md`](../../init.md) §6, §16–§17, §26.

## 1) What This Feature Is

Vector similarity search over indexed documentation, always scoped to a single project. Backs both `project-rag search` (CLI) and `search_project_docs` (MCP tool).

- Spec: [`../../init.md`](../../init.md) §16 (Retrieval), §17 (Future-Proof Retrieval Architecture)
- Planned files: `src/retrieval/search.ts`, `src/qdrant/qdrant-repository.ts`

## 2) Flow / Behavior

`project-rag search <project> "<query>"`:
1. Resolve project via registry
2. Embed the query (`EmbeddingProvider.embedQuery`)
3. Query Qdrant with `project == "<id>"` filter, `topK` = `RAG_TOP_K` (default 5)
4. Return results with file, section, score, content

## 3) Domain & Data

- Project filter is enforced at the retrieval layer itself, never left to the LLM/caller to apply (`init.md` §16, §21.7)
- Collection: `project_rag_documents`, project isolation via payload metadata (`init.md` §6)
- Designed so hybrid search, BM25, reranking, metadata filters, or per-project collections can be added later without a retrieval rewrite (`init.md` §17) — none of these are in v1

## 4) UI

Not applicable — CLI + MCP only.

## 5) Edge Cases & Rules

- A search for project A must never return project B's documents, under any circumstance (`init.md` §6, §21.7)
- `RAG_TOP_K` is configurable via env (`init.md` §16, §19)

## Related Files

- Spec source: [`../../init.md`](../../init.md) §16, §17

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [02-ingestion-full-index.md](./02-ingestion-full-index.md)
- Consumed by: [05-mcp-server.md](./05-mcp-server.md)
