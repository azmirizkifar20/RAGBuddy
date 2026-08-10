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
status Ollama's own `/api/embeddings` endpoint returns — a `500` means Ollama's server errored
while generating that embedding, not that RAGBuddy rejected anything.

Initial suspicion was resource exhaustion from `EMBEDDING_CONCURRENCY` (`5` at the time) firing
too many parallel requests at a single local Ollama process running a comparatively heavy model
(`bge-m3`). That's a real contributing risk (see Fix below), but tailing Ollama's own log
(`%LOCALAPPDATA%\Ollama\server.log` on Windows) while reproducing the error surfaced the actual,
deterministic trigger:

```
srv    send_error: task id = 447, error: input (2870 tokens) is too large to process. increase the physical batch size (current batch size: 2048)
```

This is llama.cpp's/Ollama's batch-size ceiling (`num_batch`, default `2048` tokens) — a specific
chunk's content tokenized to `2870` tokens, over the limit. `chunker.ts` caps chunks at `4000`
chars, sized on the `~4 chars/token` rule of thumb from `init.md` §8 (assuming ~1000 tokens per
chunk) — but that chunk's actual ratio was ~1.4 chars/token (dense code/technical content
tokenizes far denser than plain English prose), producing a chunk 2.8x larger in tokens than the
char-based estimate assumed. This is deterministic, not transient: retrying the identical request
fails identically every time.

## Fix

**First attempt (insufficient):** detected the batch-size ceiling by matching `too large to
process` in the failed response's body text, splitting only on a match. Rebuilt, restarted, and
re-tested — the *same* error (now `2951` tokens, a different chunk) still ended the ingest run.
The internal llama.cpp engine log and the actual HTTP response body Ollama returns to the client
aren't guaranteed to carry the same wording, so the pattern likely never matched; the code fell
through to the generic transient-failure retry path, which just resent the identical
still-oversized prompt twice more and then threw — no different from having no fix at all.

**Working fix:** stopped trying to parse Ollama's error text altogether. `embedOne` now splits any
input over `OLLAMA_SPLIT_THRESHOLD_CHARS` (800 chars) in half on **any** `500`, regardless of the
error body, and mean-pools the two halves' embeddings (`embedSplit`, recursive, capped at
`OLLAMA_MAX_SPLIT_DEPTH` = 4 levels). This is correct either way: if the input really was too
large, splitting fixes it; if the `500` was something else transient, retrying with smaller
prompts is still a reasonable fallback. Inputs at or under the threshold instead retry with
exponential backoff (500ms, then 1s) up to twice, since a `500` on an already-small input is a
genuinely transient server-side failure, not a batch-size problem. A `4xx` is never retried or
split — that's a real client-side problem.

`src/embedding/embedding-provider.ts` also has `EMBEDDING_CONCURRENCY` lowered from `5` to `2`
(Ollama provider only — the OpenAI-compatible provider already batches every text into one
request), reducing load on a single local Ollama instance.

## Verification

`tests/embedding/embedding-provider.test.ts`:
- retries a `5xx` twice then throws once retries are exhausted, for a small input (`fetch` called 3 times total)
- never retries a `4xx` (`fetch` called once)
- recovers and returns the embedding when a retry succeeds after one transient `5xx`
- splits and mean-pools a large input on `500` with no dependency on the error body's wording
- gives up splitting past `OLLAMA_MAX_SPLIT_DEPTH` and falls back to retry-then-throw, proving the
  recursion terminates instead of looping forever on a persistently-failing large input
- existing concurrency-cap test still asserts against the `EMBEDDING_CONCURRENCY` export, so it
  automatically covers the new value of `2`

Note: source changes to `src/` only take effect once `dist/` is rebuilt (`npm run build`) and the
running `node dist/cli/index.js web` process is restarted — the first fix attempt above was
verified against unit tests but the *running* web server was never rebuilt/restarted before
re-testing live, which is part of why it looked like it hadn't worked.

## Related

- [../features/02-ingestion-full-index.md](../features/02-ingestion-full-index.md)
