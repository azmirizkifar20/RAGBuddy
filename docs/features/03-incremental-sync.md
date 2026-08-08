# Incremental Sync

**Status: Planned** (Phase 3 — Incremental Sync). Not yet implemented; traced from [`../../init.md`](../../init.md) §9–§10, §12–§13, §26.

## 1) What This Feature Is

Detects added/modified/deleted/unchanged documentation files since the last index and only re-embeds what changed. This is what the Git post-commit hook calls after every commit.

- Spec: [`../../init.md`](../../init.md) §10 (Incremental Sync), §12 (Git Commit Auto Sync), §13 (Git Hook Installation)
- Planned files: `src/ingestion/{scanner,hasher,indexer}.ts`, `src/git/{git-status,git-diff}.ts`

## 2) Flow / Behavior

`project-rag sync <project>`:
1. Validate project + repository + that it is a Git repo
2. Scan configured doc paths
3. Diff against stored content hashes → added / modified / deleted / unchanged
4. Delete obsolete vectors, chunk + embed new/modified docs, upsert
5. Store current Git commit metadata
6. Print a summary (counts per category)

`project-rag hook install <project>` / `hook uninstall <project>`:
- Installs/removes a `.git/hooks/post-commit` hook that calls `project-rag sync <project>`
- Preserves any existing `post-commit` hook rather than overwriting it (chain, don't destroy)
- Never triggers a recursive commit

## 3) Domain & Data

- Same chunk/metadata shape as [full ingestion](./02-ingestion-full-index.md); sync only touches the delta
- Hook execution must never block `git commit` — Qdrant/embedding-provider/project-rag failures are caught and printed as warnings, exit success (`init.md` §12)

## 4) UI

Not applicable — CLI + Git hook only.

## 5) Edge Cases & Rules

- Unchanged files must not be re-embedded (`init.md` §10)
- Deleted files must have their vectors removed, not just skipped
- Hook install must detect and safely chain an existing user `post-commit` hook, never destroy it (`init.md` §13)

## Related Files

- Spec source: [`../../init.md`](../../init.md) §10, §12, §13

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [02-ingestion-full-index.md](./02-ingestion-full-index.md)
