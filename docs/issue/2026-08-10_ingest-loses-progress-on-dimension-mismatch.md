# Full ingest wastes an hour then fails with a raw "Bad Request" on the last write

**Date:** 2026-08-10
**Status:** Fixed

## Symptom

A full ingest of `rhapsodie-shell` (179 files, one running local Ollama `bge-m3`) ran for about an
hour, printing an `Embedding <file> (<n> chunk(s))` line for every single file with no errors, then
failed on the very last step:

```
Error: Bad Request
```

All embedding work was lost — a retry would have to redo the entire hour from scratch. Reported
alongside: "bisa ga untuk file yang udah berhasil di embed itu langsung save aja?" (can the files
that already embedded successfully just be saved immediately?).

## Root Cause

Two compounding problems:

1. **`indexProject` (`src/ingestion/indexer.ts`) only wrote to Qdrant once, at the very end.** It
   accumulated every file's embedded points in an in-memory array across the whole run, then did
   one `deleteProjectVectors` + one `upsertChunks` after the *entire* scan finished embedding. Any
   failure on that final write (or anywhere in the loop) discarded all completed work — there was
   nothing to resume from, because nothing had actually been persisted yet. `sync.ts` already used
   a different, safer pattern (delete-then-upsert per file, immediately) but `indexer.ts` never
   adopted it.

2. **The final write itself failed because of a vector-dimension mismatch.** Qdrant's shared
   collection `ragbuddy_documents` is fixed at `3072` dims (from earlier Gemini-based embeddings).
   `.env` had been switched to `EMBEDDING_PROVIDER=ollama` / `EMBEDDING_MODEL=bge-m3`, which outputs
   `1024`-dim vectors (confirmed directly via `curl http://localhost:11434/api/embeddings`).
   `ensureCollection` only ever checked whether a collection needed *creating* — it never compared
   dimensions against an *existing* collection, so the mismatch surfaced as Qdrant's own raw `400
   Bad Request` on `upsert`, with no indication of what actually went wrong. This is the exact
   failure mode already flagged (but not yet fixed) as "Known limitation — no embedding-dimension
   guard" in [../features/02-ingestion-full-index.md](../features/02-ingestion-full-index.md).

## Fix

**Per-file durability** (`src/ingestion/indexer.ts`): rewritten to mirror `sync.ts` — for each file,
delete that file's existing vectors, embed it, and upsert its new points immediately, one file at a
time, instead of batching everything into one write at the end. A failure partway through now only
loses the file being processed; every file that already finished stays indexed. Files removed from
the repo since the last run (present in Qdrant, absent from the current scan) are now also deleted
explicitly, since there's no more single delete-everything-up-front step to handle that implicitly.

**Fail-fast dimension guard** (`src/qdrant/qdrant-client.ts`): `ensureCollection` now calls
`getCollection` when the collection already exists and compares its configured vector size against
the current embedding model's output size, throwing immediately with a clear message
(`Embedding dimension mismatch: this embedding model produces N-dim vectors, but Qdrant collection
"..." is configured for M-dim vectors...`) if they differ — this fires after the *first* file
embeds, not after all 179.

**Recovering from a partial failure:** together, these mean a run that dies partway (for any
reason, not just a dimension mismatch) no longer has to be redone from scratch — run
`ragbuddy sync <project>` afterward; it skips every file whose `content_hash` already matches
what's in Qdrant and only (re)processes what didn't finish.

**Recreating the collection at a new dimension:** the dimension guard makes the failure fast and
clear, but a real embedding-model switch still needs the collection rebuilt at the new size — the
guard's error message points at a new command for exactly this: `ragbuddy qdrant drop-collection
[--yes]` (`src/cli/qdrant-command.ts` → `dropCollection` in `src/qdrant/qdrant-client.ts`). Since
the collection is shared across every registered project, this is destructive to all of them at
once — without `--yes` it only previews the list of projects that will need re-ingesting and exits
without dropping anything; `--yes` actually deletes the collection (`ensureCollection` recreates it
automatically, empty, on the next `ingest`/`sync`/upload for any project).

**Same action from the dashboard:** `GET`/`POST /api/settings/qdrant[/drop-collection]`
(`src/server/routes/settings.ts`) expose the same drop, and **Settings → Danger zone**
(`web/src/pages/settings.tsx`) surfaces it in the UI — showing the collection's current dimension,
point count, and every affected project, with the confirm button disabled until the user types the
collection's exact name into a text field (stricter than the app's existing single-click
"Remove project" confirm, given the blast radius here is every project at once, not one registry
entry). The `POST` route itself requires `{ confirm: true }` in the body as a lighter server-side
guard against an accidental bare request.

## Verification

`tests/ingestion/indexer.test.ts`:
- a mid-run embedding failure leaves the earlier file's points already upserted (`upsert` called
  once, for the file that succeeded, before the rejection propagates)
- a dimension mismatch throws after the *first* file's embed call, not after every file
- existing tests updated for per-file delete (`deleteFileVectors`-shaped filter) instead of a
  whole-project delete, and for explicit removal of a file no longer present in the scan

`tests/qdrant/qdrant-client.test.ts`: `ensureCollection` throws a descriptive error when an
existing collection's vector size doesn't match; still creates cleanly when the collection is new
or the size already matches. `dropCollection` deletes an existing collection and is a no-op when
it's already gone.

`tests/cli/args.test.ts` + `tests/cli/qdrant-command.test.ts`: `ragbuddy qdrant drop-collection`
parses `--yes` correctly; `runQdrantDropCollection` reports the affected project ids without
calling the drop when unconfirmed, and actually drops when confirmed.

`tests/server/routes/settings.test.ts`: `GET /api/settings/qdrant` reports `exists: false` without
calling `getCollection` when the collection is missing, and reports vector size + point count when
it exists; `POST /api/settings/qdrant/drop-collection` rejects a request without
`confirm: true` and drops + reports affected projects when confirmed.

## Related

- [../features/02-ingestion-full-index.md](../features/02-ingestion-full-index.md)
- [2026-08-10_ollama-embedding-500.md](./2026-08-10_ollama-embedding-500.md)
- [2026-08-10_gemini-batch-embed-limit.md](./2026-08-10_gemini-batch-embed-limit.md)
