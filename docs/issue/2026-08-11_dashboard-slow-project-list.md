# Dashboard and project list load slowly as indexed data grows

**Date:** 2026-08-11
**Status:** Fixed

## Symptom

The dashboard and `/projects` page took noticeably longer to load than expected, worse the more a
project had been indexed. With a handful of projects and several thousand chunks total, a single
`GET /api/projects` load stretched into multiple seconds.

## Root Cause

`GET /api/projects` and `GET /api/projects/:id` (`src/server/routes/projects.ts`) computed
`indexedFileCount`/`chunkCount`/`uploadCount` on every single request by calling
`getIndexedFiles()` (`src/qdrant/qdrant-repository.ts`), which scrolls **every chunk of every
project** out of Qdrant, 200 points per page, purely to count them. This wasn't a JSON-storage
problem — the local registry/history files are tiny and read synchronously in negligible time.
The cost was entirely the full-collection scroll, repeated per project, on every page load:

- `ProjectsProvider` (`web/src/lib/projects-context.tsx`) fetches `GET /api/projects` once at the
  app root, so every navigation into the dashboard or projects list paid this cost.
- With real data (one project at 3,157 chunks, others at a few hundred each), that's dozens of
  sequential Qdrant round-trips just to render summary numbers on cards — and it scaled worse as
  more projects/documents were indexed, with no caching at any layer.

## Fix

Added a small cache — `ProjectStatsStore` (`src/projects/project-stats.ts`,
`data/project-stats.json`) — holding `{ indexedFileCount, chunkCount, uploadCount, updatedAt }`
per project:

- `GET /api/projects`/`GET /api/projects/:id` now read this cache first; a cache miss (e.g. a
  project that predates this cache) falls back to one live `computeProjectDataStats()` call
  (same scroll as before) and caches the result, so only the *first* request per project pays for
  it.
- The cache is refreshed by the operations that actually change what's indexed:
  `indexProject` (always — a full rebuild always changes something), `uploadDocument` and
  `removeUpload` (always), and `syncProject` — but **only when `added`/`modified`/`deleted` is
  non-empty**. This last part matters because `syncProject` is what the `post-commit`/
  `post-merge`/`post-checkout` Git hooks call on every commit/pull/branch-switch
  ([06-git-hook-auto-sync.md](./../features/06-git-hook-auto-sync.md)), and most of those runs
  find nothing changed — refreshing the cache unconditionally there would have reintroduced the
  same full-scroll cost on every Git operation instead of every page load.
- `ragbuddy qdrant drop-collection` clears the cache for every affected project, so the dashboard
  doesn't keep showing stale counts for a collection that no longer has any data.
- The refresh is best-effort: wrapped in try/catch (`refreshProjectStats`), logging a warning
  instead of failing the ingest/sync/upload operation it rides along with.

## Verification

Manual run against the real dashboard data (5 registered projects, one at 3,157 chunks): started
`ragbuddy web` fresh, hit `GET /api/projects` twice —

- First request (cache miss for every project): **3.36s**
- Second request (cache hit): **0.006s**

`data/project-stats.json` inspected directly afterward and matched the real per-project counts.
Automated: `tests/projects/project-stats.test.ts` (store persistence, `refreshProjectStats`
success/failure), `tests/qdrant/qdrant-repository.test.ts` (`computeProjectDataStats`), plus
targeted cases in `tests/ingestion/{indexer,sync,uploads}.test.ts` and
`tests/server/routes/projects.test.ts` proving the sync-skip-when-unchanged behavior and the
cache-hit-skips-Qdrant behavior specifically (not just that the feature works once).

## Related

- [../features/08-dashboard-redesign-uploads-and-history.md](../features/08-dashboard-redesign-uploads-and-history.md) — where `chunkCount`/`uploadCount` were first added to the API
- [../features/06-git-hook-auto-sync.md](../features/06-git-hook-auto-sync.md) — why `syncProject` runs far more often than a manual `ragbuddy sync`
