# OpenAI-compatible embedding fails: "at most 100 requests can be in one batch"

**Date:** 2026-08-10
**Status:** Fixed

## Symptom

Ingesting `rhapsodie-shell` with `EMBEDDING_PROVIDER=openai` (a proxy in front of
`gemini/gemini-embedding-2-preview`, `EMBEDDING_BASE_URL=http://100.108.87.26:20128/v1`) failed with:

```
[400]: * BatchEmbedContentsRequest.requests: at most 100 requests can be in one batch
```

Traced to `docs/business-notes/vendor-event/Rhapsodie_Live_Document.md`, which chunks to 207
pieces.

## Root Cause

`OpenAICompatibleEmbeddingProvider.embedDocuments` (`src/embedding/embedding-provider.ts`) sent
every chunk of a file in a single `POST /embeddings` request via one `input` array. The proxy
translates that into Gemini's `BatchEmbedContentsRequest`, which Gemini hard-caps at 100 items per
batch — any file chunking to more than 100 pieces (as this 207-chunk file did) always 400s,
deterministically, regardless of retries.

This is a distinct failure mode from
[2026-08-10_ollama-embedding-500.md](./2026-08-10_ollama-embedding-500.md) (Ollama's per-token
batch-size ceiling) — same symptom category (a provider-side batch limit exceeded), different
provider, different limit (item count vs. token count), different fix.

## Fix

`src/embedding/embedding-provider.ts`: `embedDocuments` now slices `texts` into batches of at most
`OPENAI_MAX_BATCH_SIZE` (100) before calling `request()`, issuing one request per batch and
concatenating the results. 100 is comfortably under every other OpenAI-compatible provider's own
batch limits too, so splitting unconditionally (not just for Gemini) is safe.

**Follow-up:** fixing the batch-size 400 surfaced a second, separate proxy limit on the next
ingest attempt: `Embedding request failed: 429 Too Many Requests` (a rate limit — this
provider previously had zero retry logic at all). `request()` now retries a `429` or a `5xx` with
backoff (up to `OPENAI_MAX_RETRIES` = 4 attempts), honoring a numeric `Retry-After` response
header when the proxy sends one, falling back to exponential backoff (1s, 2s, 4s, 8s) otherwise. A
4xx other than 429 is still never retried — that's a real client-side problem.

## Verification

`tests/embedding/embedding-provider.test.ts`:
- a 207-item `embedDocuments` call is split into batches of `100, 100, 7`, three requests total,
  results concatenated in original order
- a `429` retries with backoff and succeeds
- a numeric `Retry-After` header is honored instead of the default backoff
- a transient `5xx` retries then throws once `OPENAI_MAX_RETRIES` is exhausted
- a non-429 `4xx` (e.g. `400`) is never retried

## Related

- [../features/02-ingestion-full-index.md](../features/02-ingestion-full-index.md)
- [2026-08-10_ollama-embedding-500.md](./2026-08-10_ollama-embedding-500.md)
