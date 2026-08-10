# Ollama embedding request fails with 500 Internal Server Error

**Date:** 2026-08-10
**Status:** Mitigated

## Symptom

Full ingest of a project (`rhapsodie-shell`) failed twice in a row with:

```
Ollama embedding request failed: 500 Internal Server Error
```

Both failures happened ~78-81s into the run, while `.env` had `EMBEDDING_PROVIDER=ollama` /
`EMBEDDING_MODEL=bge-m3` pointed at a local Ollama instance (`http://localhost:11434`).

## Root Cause

`OllamaEmbeddingProvider.embedOne` (`src/embedding/embedding-provider.ts`) just relays whatever
status Ollama's own `/api/embeddings` endpoint returns — a `500` means Ollama's server crashed
while generating that embedding, not that RAGBuddy rejected anything. `embedDocuments` fired
`EMBEDDING_CONCURRENCY` (previously `5`) parallel requests at the local Ollama process; `bge-m3`
is a comparatively heavy embedding model, and 5 concurrent embed calls against a single local
instance can exhaust its resources and make the server itself error out mid-batch. There was also
no retry: one transient `500` aborted the entire ingest run instead of just that one chunk.

Chunk size was ruled out — `chunker.ts` caps chunks at 4000 chars (~1000 tokens), well under
`bge-m3`'s context window, so an oversized chunk wasn't the trigger.

## Fix

`src/embedding/embedding-provider.ts`:
- Lowered `EMBEDDING_CONCURRENCY` from `5` to `2` (this constant only affects the Ollama provider —
  the OpenAI-compatible provider already batches every text into a single request).
- `embedOne` now retries a `5xx` response up to twice with exponential backoff (500ms, then 1s)
  before throwing. A `4xx` is never retried — that's a real client-side problem, not a transient
  server hiccup.

## Verification

`tests/embedding/embedding-provider.test.ts`:
- retries a `5xx` twice then throws once retries are exhausted (`fetch` called 3 times total)
- never retries a `4xx` (`fetch` called once)
- recovers and returns the embedding when a retry succeeds after one transient `5xx`
- existing concurrency-cap test still asserts against the `EMBEDDING_CONCURRENCY` export, so it
  automatically covers the new value of `2`

## Related

- [../features/02-ingestion-full-index.md](../features/02-ingestion-full-index.md)
