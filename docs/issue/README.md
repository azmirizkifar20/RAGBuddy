# Issue Tracking

This folder contains bug reports, root cause analysis, and issue findings.

## Naming Convention

Issue documentation follows the format: `YYYY-MM-DD_issue-name.md`

## Index

- [2026-08-10_ollama-embedding-500.md](./2026-08-10_ollama-embedding-500.md) — Ollama `/api/embeddings` returning `500` on a chunk over its batch-size ceiling; fixed by splitting large inputs and mean-pooling, plus lower concurrency.
- [2026-08-10_gemini-batch-embed-limit.md](./2026-08-10_gemini-batch-embed-limit.md) — OpenAI-compatible (Gemini proxy) embedding 400s past 100 items in one batch, then 429s from zero retry logic; fixed by chunking `embedDocuments` into batches of 100 plus 429/5xx retry-with-backoff.
- [2026-08-10_ingest-loses-progress-on-dimension-mismatch.md](./2026-08-10_ingest-loses-progress-on-dimension-mismatch.md) — a full ingest lost an hour of embedding work to a dimension-mismatch "Bad Request" on the final write; fixed with per-file persistence (mirrors `sync.ts`) plus a fail-fast dimension guard in `ensureCollection`.
- [2026-08-10_ingest-fails-on-dropped-collection.md](./2026-08-10_ingest-fails-on-dropped-collection.md) — regression from the per-file persistence fix above: ingest 404'd on the first file right after `qdrant drop-collection`, since it deleted-before-checking the collection existed; fixed by checking existence once up front and skipping the delete when there's nothing to delete.

---

**Catatan**: Buat dokumentasi issue baru dengan format `YYYY-MM-DD_nama-issue.md` saat diminta oleh user.
