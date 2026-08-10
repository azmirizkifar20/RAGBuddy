# Ingest fails immediately with "Not Found" right after dropping the Qdrant collection

**Date:** 2026-08-10
**Status:** Fixed

## Symptom

```
$ ragbuddy ingest rhapsodie-shell
Scanned 179 file(s)
Removing old vectors for docs/audits/README.md
Error: Not Found
```

Failed on the very first file, immediately after `ragbuddy qdrant drop-collection --yes` had been
run earlier to prepare for switching embedding models (see
[2026-08-10_ingest-loses-progress-on-dimension-mismatch.md](./2026-08-10_ingest-loses-progress-on-dimension-mismatch.md)).

## Root Cause

A regression introduced by that same per-file-durability fix. `indexProject`
(`src/ingestion/indexer.ts`) now calls `deleteFileVectors` unconditionally at the top of the
per-file loop, for every file, before `ensureCollection` ever runs (which only happens after the
*first* file's embedding succeeds, since it needs that file's vector size). Deleting from a Qdrant
collection that doesn't exist yet — exactly the state right after `qdrant drop-collection`, before
anything has been re-ingested — returns `404 Not Found`, which propagated straight up and aborted
the run on the very first file.

`syncProject` (`src/ingestion/sync.ts`) never had this bug: it only calls `deleteFileVectors` for
files it already knows were previously indexed (via `getIndexedFileHashes`, which itself returns
an empty map when the collection is missing), so on a missing collection every file is classified
"added" and delete is never attempted. `indexProject`'s "always delete first" per-file design has
no such natural guard. `removeUpload` (`src/ingestion/uploads.ts`) had the same latent bug —
untouched by the per-file refactor, but now more likely to be hit given `qdrant drop-collection`
exists as a normal, documented action.

## Fix

`src/ingestion/indexer.ts`: check whether the collection exists once, up front (a single
`getCollections()` call, not per file), and skip the per-file delete entirely when it doesn't —
there is nothing to delete from a collection that isn't there.

`src/ingestion/uploads.ts`: `removeUpload` gets the same guard (checked once, since it's a single
delete per call, not a loop).

`upsertChunks`/`ensureCollection` are unaffected — they either create the collection (`ensureCollection`,
called after the first file embeds) or write to it once it exists, so neither needed a change.

## Verification

`tests/ingestion/indexer.test.ts`:
- a fresh/missing collection: no delete call is made, ingest still succeeds
- an existing collection: the per-file delete still happens, with the same per-file filter as before
- a regression test that mocks `delete` to reject (matching Qdrant's real 404 behavior) against a
  missing collection and asserts `indexProject` still succeeds *and* `delete` was never called —
  fails loudly if this guard is ever removed

`tests/ingestion/uploads.test.ts`: `removeUpload` against a missing collection removes the file on
disk without calling `delete`.

## Related

- [2026-08-10_ingest-loses-progress-on-dimension-mismatch.md](./2026-08-10_ingest-loses-progress-on-dimension-mismatch.md)
- [../features/02-ingestion-full-index.md](../features/02-ingestion-full-index.md)
