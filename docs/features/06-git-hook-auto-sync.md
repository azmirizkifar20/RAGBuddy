# Git Hook Auto Sync

**Status: Implemented** (Phase 6 — Git Hook). Traced from [`../../init.md`](../../init.md) §12–§13, §26. This was the last of the six phases in `init.md` §26 — all phases are now implemented (see `docs/features/README.md`'s index).

## 1) What This Feature Is

Wires `git commit` in a registered project's repo to automatically trigger `ragbuddy sync <project>` via a `post-commit` hook, without ever breaking the developer's commit workflow.

- Spec: [`../../init.md`](../../init.md) §12 (Git Commit Auto Sync), §13 (Git Hook Installation)
- Implementation: `src/git/hook-installer.ts`, `src/cli/hook-command.ts`, `src/cli/{args,index}.ts` (extended for the `hook` command)

## 2) Flow / Behavior

```
edit docs → git add → git commit → post-commit → ragbuddy sync → Qdrant updated
```

`ragbuddy hook install <project>`:
1. Validate the Git repository
2. Create/update `.git/hooks/post-commit` to call `ragbuddy sync <project>`
3. If a `post-commit` hook already exists, chain into it rather than overwriting it
4. Document how the hook works

`ragbuddy hook uninstall <project>` removes the chained call (restoring any prior hook content).

## 3) Domain & Data

No new data — this feature is purely operational glue around [incremental sync](./03-incremental-sync.md).

## 4) UI

Not applicable — Git hook + CLI only.

## 5) Edge Cases & Rules

- The hook must catch and warn on failures (Qdrant down, embedding provider down, ragbuddy unavailable) and still let the commit succeed (`init.md` §12)
- The sync process itself must never create another commit (no recursive Git operations) (`init.md` §12)
- Installing must never destroy a pre-existing user `post-commit` hook (`init.md` §13)

## Related Files

- `src/git/hook-installer.ts` — `installHook`/`uninstallHook`: marker-delimited `.git/hooks/post-commit` block, bakes in an absolute path to this installation's `dist/cli/index.js` (no reliance on `ragbuddy` being on `PATH`, since this is a local dev tool, not a globally published package)
- `src/cli/hook-command.ts` — `runHookCommand`: registry lookup + delegate, mirrors `ingest-command.ts`/`sync-command.ts`/`search-command.ts`
- `src/cli/args.ts`, `src/cli/index.ts` — extended for `hook install|uninstall <project>`
- Manually verified end-to-end (not just unit-tested): installed the hook in a scratch repo, made a real commit with `QDRANT_URL`/`EMBEDDING_PROVIDER` pointing at unreachable services — the hook printed `[ragbuddy] Sync started...`, then a warning on failure, and the commit still succeeded (`git commit` exit code 0)
- Spec source: [`../../init.md`](../../init.md) §12, §13

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [03-incremental-sync.md](./03-incremental-sync.md)
