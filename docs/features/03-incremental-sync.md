# Incremental Sync

**Status: Implemented** (Phase 3 — Incremental Sync). Traced from [`../../init.md`](../../init.md) §9–§10, §12–§13, §26.

## 1) What This Feature Is

Detects added/modified/deleted/unchanged documentation files since the last index and only re-embeds what changed. Once Phase 6 wires up the Git post-commit hook, this is what it will call after every commit — for now, `ragbuddy sync <project>` must be run manually.

- Spec: [`../../init.md`](../../init.md) §10 (Incremental Sync), §12 (Git Commit Auto Sync), §13 (Git Hook Installation)

## 2) Flow / Behavior

`ragbuddy sync <project>`:
1. Validate project + repository + that it is a Git repo
2. Scan configured doc paths
3. Diff against stored content hashes → added / modified / deleted / unchanged
4. Delete obsolete vectors, chunk + embed new/modified docs, upsert
5. Store current Git commit metadata
6. Print a summary (counts per category)

**Note:** `hook install`/`hook uninstall` are Phase 6 (Git Hook) — not yet implemented. The bullets below describe the planned behavior; today, `sync` must be invoked manually.

`ragbuddy hook install <project>` / `hook uninstall <project>` (planned):
- Installs/removes a `.git/hooks/post-commit` hook that calls `ragbuddy sync <project>`
- Preserves any existing `post-commit` hook rather than overwriting it (chain, don't destroy)
- Never triggers a recursive commit

## 3) Domain & Data

- Same chunk/metadata shape as [full ingestion](./02-ingestion-full-index.md); sync only touches the delta
- Hook execution must never block `git commit` — Qdrant/embedding-provider/ragbuddy failures are caught and printed as warnings, exit success (`init.md` §12). This rule applies once the Phase 6 hook exists; not yet implemented.

## 4) UI

Not applicable — CLI + Git hook only.

## 5) Edge Cases & Rules

- The repository root README is included in the scan regardless of configured `paths` (see [02-ingestion-full-index.md §3](./02-ingestion-full-index.md#3-domain--data)) — the diff treats it like any other scanned file, so it shows up as `added` the first time a project syncs after this rule was introduced, then `unchanged` on every sync after that.
- Unchanged files must not be re-embedded (`init.md` §10)
- Deleted files must have their vectors removed, not just skipped
- Hook install must detect and safely chain an existing user `post-commit` hook, never destroy it (`init.md` §13). This is a Phase 6 requirement; hook install itself is not yet implemented.

## Related Files

- `src/ingestion/sync.ts` — incremental sync orchestrator
- `src/ingestion/payload-builder.ts` — shared chunk/payload helpers (extracted from Phase 2's indexer)
- `src/qdrant/qdrant-repository.ts` — extended with `getIndexedFileHashes`/`deleteFileVectors`
- `src/cli/{args,sync-command,index}.ts` — dual ingest/sync CLI dispatch
- Spec source: [`../../init.md`](../../init.md) §10, §12, §13

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [02-ingestion-full-index.md](./02-ingestion-full-index.md)
