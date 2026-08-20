# Retrieval / Search

**Status: Implemented** (Phase 4 — Retrieval). Traced from [`../../init.md`](../../init.md) §6, §16–§17, §26.

## 1) What This Feature Is

Vector similarity search over indexed documentation, always scoped to a single project. Backs `ragbuddy search` (CLI, implemented in this phase). It will also back `search_project_docs` (MCP tool) once Phase 5 wires up the MCP server — that tool doesn't exist yet, but it will call the same `searchProject` function this phase built, not a separate implementation.

- Spec: [`../../init.md`](../../init.md) §16 (Retrieval), §17 (Future-Proof Retrieval Architecture)
- Implementation: `src/retrieval/search.ts` (`searchProject`), `src/qdrant/qdrant-repository.ts` (`searchPoints`, extended in this phase), `src/cli/search-command.ts`, `src/cli/{args,index}.ts` (extended for the `search` command)

## 2) Flow / Behavior

`ragbuddy search <project> "<query>"`:
1. Resolve project via registry
2. Embed the query (`EmbeddingProvider.embedQuery`)
3. Query Qdrant with `project == "<id>"` filter, `topK` = `RAG_TOP_K` (default 5)
4. Return results with file, section, score, content

### `ragbuddy ask <project> "<query>"` (2026-08-13)

A one-shot, RAG-grounded question answered directly in the terminal — no dashboard, no chat session. Unlike `search` (returns raw chunks), `ask` returns an actual LLM answer:

1. Resolve project via registry (`src/cli/ask-command.ts` → `runAskCommand`, same registry-lookup-then-delegate shape as `search-command.ts`/`sync-command.ts`).
2. Run the shared RAG pipeline — `getRagResults` (`src/retrieval/rag-context.ts`): rewrite → hybrid (vector + BM25) search → rerank, using the active chat credential/model (`chatCredentials.get()`), never the embedding-only config.
3. One blocking `completeOnce` call (`src/chat/complete-once.ts`) answers the question, with retrieved chunks injected as supplementary context when any were found.
4. Prints the answer, then a `Sources:` list (`[score] file — section`) when RAG found anything. If retrieval itself failed, it still prints an answer (from the model's own knowledge) plus a `Warning: RAG lookup failed...` line — same graceful-degradation contract as the chat route.

`getRagResults` is the extraction point that makes this possible without duplicating logic: it was pulled out of the chat route's inline RAG block (`src/server/routes/chat.ts`) into its own module specifically so `ask` could reuse the identical rewrite/hybrid-search/rerank pipeline instead of re-implementing it. `ask` always has RAG on — there's no `--no-rag` flag, since RAG grounding in project docs is the entire reason to reach for `ragbuddy ask` instead of any other LLM CLI.

## 3) Domain & Data

- Project filter is enforced at the retrieval layer itself, never left to the LLM/caller to apply (`init.md` §16, §21.7)
- Collection: `ragbuddy_documents`, project isolation via payload metadata (`init.md` §6)
- Designed so metadata filters or per-project collections can be added later without a retrieval rewrite (`init.md` §17) — neither is in v1
- Query rewriting, hybrid (vector + BM25) search, and reranking now exist (`src/retrieval/query-rewrite.ts`, `src/retrieval/hybrid-search.ts`, `src/retrieval/bm25.ts`, `src/retrieval/bm25-index.ts`, `src/retrieval/rerank.ts`, `src/retrieval/rag-context.ts`, plus `searchProjectMultiQuery` here) as additive functions layered on top of `searchProject`, used by **chat**, **`ragbuddy ask`**, and (since 2026-08-20) the **`POST /api/projects/:id/search` route** — see [09-project-chat.md](./09-project-chat.md) and [12-external-web-app-integration.md](./12-external-web-app-integration.md). Only the CLI `search` command and the MCP tool still call bare `searchProject` (dense-vector only, no rewrite/rerank). The BM25 lexical index is built from the same chunk corpus via `getProjectChunks` (`src/qdrant/qdrant-repository.ts`) but is an in-memory, lazily-cached structure scoped to whichever process builds it (the `web` server for chat/search/`ask`, or the short-lived CLI process for `ask`) — it is not written back to Qdrant and doesn't change how `searchPoints` itself queries.

## 4) UI

Not applicable — CLI + MCP only.

## 5) Edge Cases & Rules

- A search for project A must never return project B's documents, under any circumstance (`init.md` §6, §21.7)
- `RAG_TOP_K` is configurable via env (`init.md` §16, §19)

## Related Files

- `src/retrieval/search.ts` — `searchProject`: embeds the query, calls `searchPoints`, shapes `{file, section, score, content}` results
- `src/qdrant/qdrant-repository.ts` — `searchPoints`: project-filtered `client.query()` wrapper (note: the underlying `@qdrant/js-client-rest` v1.19.0 API is `query()`, not the older `search()` some docs still describe)
- `src/cli/search-command.ts` — `runSearchCommand`: registry lookup + delegate, mirrors `ingest-command.ts`/`sync-command.ts`
- `src/cli/ask-command.ts` — `runAskCommand`: same registry-lookup-then-delegate shape, for the RAG-grounded one-shot answer (2026-08-13)
- `src/cli/args.ts`, `src/cli/index.ts` — extended for the `search <project> "<query>"` and `ask <project> "<query>"` commands (multi-word queries are joined even if the shell doesn't quote them)
- `src/retrieval/rag-context.ts` — `getRagResults`: the shared rewrite → hybrid search → rerank pipeline behind the chat route, `ragbuddy ask`, and the `/api/projects/:id/search` route
- `src/retrieval/query-rewrite.ts`, `src/retrieval/hybrid-search.ts`, `src/retrieval/bm25.ts`, `src/retrieval/bm25-index.ts`, `src/retrieval/rerank.ts` — query enhancement used via `getRagResults`, see [09-project-chat.md](./09-project-chat.md)
- `src/server/routes/search.ts` — `registerSearchRoutes`: the external-facing retrieval-only endpoint, upgraded (2026-08-20) from bare `searchProject` to `getRagResults` so external callers get the same retrieval quality as chat without needing the chat feature itself; accepts an optional `history` field for query-rewrite
- Spec source: [`../../init.md`](../../init.md) §16, §17

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [02-ingestion-full-index.md](./02-ingestion-full-index.md)
- Consumed by: [05-mcp-server.md](./05-mcp-server.md), [09-project-chat.md](./09-project-chat.md), [12-external-web-app-integration.md](./12-external-web-app-integration.md) (query rewriting + hybrid search + reranking via `getRagResults`, shared by chat, `ragbuddy ask`, and the external `/search` route, on top of the same `searchProject`)
