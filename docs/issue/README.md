# Issue Tracking

This folder contains bug reports, root cause analysis, and issue findings.

## Naming Convention

Issue documentation follows the format: `YYYY-MM-DD_issue-name.md`

## Index

- [2026-08-10_ollama-embedding-500.md](./2026-08-10_ollama-embedding-500.md) — Ollama `/api/embeddings` returning `500` on a chunk over its batch-size ceiling; fixed by splitting large inputs and mean-pooling, plus lower concurrency.
- [2026-08-10_gemini-batch-embed-limit.md](./2026-08-10_gemini-batch-embed-limit.md) — OpenAI-compatible (Gemini proxy) embedding 400s past 100 items in one batch, then 429s from zero retry logic; fixed by chunking `embedDocuments` into batches of 100 plus 429/5xx retry-with-backoff.
- [2026-08-10_ingest-loses-progress-on-dimension-mismatch.md](./2026-08-10_ingest-loses-progress-on-dimension-mismatch.md) — a full ingest lost an hour of embedding work to a dimension-mismatch "Bad Request" on the final write; fixed with per-file persistence (mirrors `sync.ts`) plus a fail-fast dimension guard in `ensureCollection`.
- [2026-08-10_ingest-fails-on-dropped-collection.md](./2026-08-10_ingest-fails-on-dropped-collection.md) — regression from the per-file persistence fix above: ingest 404'd on the first file right after `qdrant drop-collection`, since it deleted-before-checking the collection existed; fixed by checking existence once up front and skipping the delete when there's nothing to delete.
- [2026-08-11_header-border-misalignment.md](./2026-08-11_header-border-misalignment.md) — sidebar/topbar bottom borders looked stepped at their shared seam (only visible at fractional display scaling); a color-mismatch optical illusion, not a geometry bug — fixed by matching the topbar's background/border tokens to the sidebar's for that one row.
- [2026-08-11_upload-progress-feedback.md](./2026-08-11_upload-progress-feedback.md) — document upload had no progress feedback for large/slow files; fixed with an `EmbeddingProvider.embedDocuments` progress callback, an SSE upload endpoint (`event: log`/`progress`/`done`/`error`), and an animated progress bar in the upload panel.
- [2026-08-11_mermaid-error-leaks-into-body.md](./2026-08-11_mermaid-error-leaks-into-body.md) — a broken Mermaid diagram in a chat reply rendered as a giant raw error box leaked directly under `<body>` (outside the message, below the input) instead of a contained "Invalid diagram" notice — two real mermaid bugs (resolves instead of throwing on many parse errors; leaks a scratch DOM element on the errors that do throw), both fixed in `MermaidBlock`.
- [2026-08-11_dashboard-slow-project-list.md](./2026-08-11_dashboard-slow-project-list.md) — dashboard/projects page loaded slowly because `GET /api/projects` scrolled every chunk of every project out of Qdrant on every request just to count them; fixed with a `ProjectStatsStore` cache refreshed by ingest/sync/upload instead of recomputed on every page load (3.36s → 0.006s in a live test).
- [2026-08-13_electron-hook-launches-gui.md](./2026-08-13_electron-hook-launches-gui.md) — the packaged Electron app's window popped open on every commit in a project whose auto-sync hook was enabled from inside the desktop app, because `process.execPath` there is always the Electron binary and the hook script never set `ELECTRON_RUN_AS_NODE=1`; fixed by always forcing that env var on the hook's own invocation line.

---

**Catatan**: Buat dokumentasi issue baru dengan format `YYYY-MM-DD_nama-issue.md` saat diminta oleh user.
