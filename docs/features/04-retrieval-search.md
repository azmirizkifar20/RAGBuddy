# Retrieval / Search

**Status: Implemented** (Phase 4 — Retrieval). Traced from [`../../init.md`](../../init.md) §6, §16–§17, §26.

## 1) What This Feature Is

Vector similarity search over indexed documentation, always scoped to a single project. Backs `project-rag search` (CLI, implemented in this phase). It will also back `search_project_docs` (MCP tool) once Phase 5 wires up the MCP server — that tool doesn't exist yet, but it will call the same `searchProject` function this phase built, not a separate implementation.

- Spec: [`../../init.md`](../../init.md) §16 (Retrieval), §17 (Future-Proof Retrieval Architecture)
- Implementation: `src/retrieval/search.ts` (`searchProject`), `src/qdrant/qdrant-repository.ts` (`searchPoints`, extended in this phase), `src/cli/search-command.ts`, `src/cli/{args,index}.ts` (extended for the `search` command)

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

- `src/retrieval/search.ts` — `searchProject`: embeds the query, calls `searchPoints`, shapes `{file, section, score, content}` results
- `src/qdrant/qdrant-repository.ts` — `searchPoints`: project-filtered `client.query()` wrapper (note: the underlying `@qdrant/js-client-rest` v1.19.0 API is `query()`, not the older `search()` some docs still describe)
- `src/cli/search-command.ts` — `runSearchCommand`: registry lookup + delegate, mirrors `ingest-command.ts`/`sync-command.ts`
- `src/cli/args.ts`, `src/cli/index.ts` — extended for the `search <project> "<query>"` command (multi-word queries are joined even if the shell doesn't quote them)
- Spec source: [`../../init.md`](../../init.md) §16, §17

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [02-ingestion-full-index.md](./02-ingestion-full-index.md)
- Consumed by: [05-mcp-server.md](./05-mcp-server.md)
