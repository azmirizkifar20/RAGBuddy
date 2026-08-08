# Git Hook Auto Sync

**Status: Planned** (Phase 6 — Git Hook). Not yet implemented; traced from [`../../init.md`](../../init.md) §12–§13, §26.

## 1) What This Feature Is

Wires `git commit` in a registered project's repo to automatically trigger `project-rag sync <project>` via a `post-commit` hook, without ever breaking the developer's commit workflow.

- Spec: [`../../init.md`](../../init.md) §12 (Git Commit Auto Sync), §13 (Git Hook Installation)
- Planned files: `src/git/{git-status,git-diff}.ts`, hook installer under `src/cli/`

## 2) Flow / Behavior

```
edit docs → git add → git commit → post-commit → project-rag sync → Qdrant updated
```

`project-rag hook install <project>`:
1. Validate the Git repository
2. Create/update `.git/hooks/post-commit` to call `project-rag sync <project>`
3. If a `post-commit` hook already exists, chain into it rather than overwriting it
4. Document how the hook works

`project-rag hook uninstall <project>` removes the chained call (restoring any prior hook content).

## 3) Domain & Data

No new data — this feature is purely operational glue around [incremental sync](./03-incremental-sync.md).

## 4) UI

Not applicable — Git hook + CLI only.

## 5) Edge Cases & Rules

- The hook must catch and warn on failures (Qdrant down, embedding provider down, project-rag unavailable) and still let the commit succeed (`init.md` §12)
- The sync process itself must never create another commit (no recursive Git operations) (`init.md` §12)
- Installing must never destroy a pre-existing user `post-commit` hook (`init.md` §13)

## Related Files

- Spec source: [`../../init.md`](../../init.md) §12, §13

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [03-incremental-sync.md](./03-incremental-sync.md)
