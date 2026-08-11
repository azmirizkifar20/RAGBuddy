# Document upload has no progress feedback for large, slow files

**Date:** 2026-08-11
**Status:** Fixed

## Symptom

On `/projects/:id/documents`, uploading a large file (long extraction, many chunks to embed) left
the drop zone showing a static "Indexing 1/1..." with no animation and no indication of what was
actually happening or how far along it was — the request just blocked until the whole
extract → chunk → embed → save pipeline finished.

## Root Cause

Not a bug — the original design (per
[08-dashboard-redesign-uploads-and-history.md](../features/08-dashboard-redesign-uploads-and-history.md))
never had a way to report progress: `POST /api/projects/:id/uploads` was one blocking request/JSON
response, and `uploadDocument` (`src/ingestion/uploads.ts`) already declared an `onLog` callback in
its deps but never called it anywhere. `EmbeddingProvider.embedDocuments` (`src/embedding/embedding-provider.ts`)
had no way to report per-item progress either — it just resolved once with every vector.

## Fix

**`src/embedding/embedding-provider.ts`:** `embedDocuments(texts, onProgress?)` gained an optional
second parameter, `(done: number, total: number) => void` — called once per text for the Ollama
provider, once per ≤100-item batch for the OpenAI-compatible provider (its real unit of work,
since it batches). Backward compatible — every existing caller that doesn't pass it is unaffected.

**`src/ingestion/uploads.ts`:** `uploadDocument` now actually calls the (previously-declared,
never-used) `onLog` at each real stage — extracting, chunked-into-N, embedding (plus a tick per
`onProgress` call), saving, upserted — and gained a new `onProgress?: (done, total) => void` in
`UploadDeps`, forwarded straight into `embedDocuments`.

**`src/server/routes/uploads.ts`:** `POST /:id/uploads` is now SSE (`startSse`/`sendSseEvent`,
same pattern as `ingest`/`sync`), emitting `event: log` for each stage message, `event: progress`
for each embedding tick, then `event: done` with the same result shape the endpoint used to return
directly, or `event: error`. Filename/body validation still 400s before the stream starts.

**`web/src/lib/api-client.ts`:** new `streamUploadDocument` (SSE-consuming, mirrors
`streamProjectChat`'s frame-parsing) replaces the old plain-`fetch`-returning `uploadDocument`.

**`web/src/components/upload-panel.tsx`:** tracks the latest `onLog` line as the current stage
label and renders a progress bar — a real, animated-width percentage while `onProgress` events are
arriving (the embedding stage), an indeterminate sliding-segment animation otherwise (extracting,
chunking, saving — stages with no total to show a percentage of). New `.progress-bar-indeterminate`
utility in `web/src/index.css` (a `translateX` sweep, `--animate-progress-indeterminate`) — like
every other animation in the app, it's neutralized by the existing global
`prefers-reduced-motion` guard automatically.

## Verification

`tests/embedding/embedding-provider.test.ts`: one `onProgress` tick per text (Ollama), one per
batch of ≤100 (OpenAI-compatible, checked with 150 texts → ticks at 100 and 150).

`tests/ingestion/uploads.test.ts`: the full ordered sequence of `onLog` messages for one upload,
plus `onProgress` receiving the expected `(done, total)`.

`tests/server/routes/uploads.test.ts`: the upload route now asserts against SSE frames
(`event: log`/`progress`/`done`/`error` in `res.text`) instead of a JSON body; a dedicated test
for the `progress` event; the unsupported-file-type case now asserts `event: error` instead of a
`400` status (still 200 — the stream itself always starts once body validation passes).

## Related

- [../features/08-dashboard-redesign-uploads-and-history.md](../features/08-dashboard-redesign-uploads-and-history.md)
