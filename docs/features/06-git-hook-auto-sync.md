# Git Hook Auto Sync

**Status: Implemented** (Phase 6 — Git Hook). Traced from [`../../init.md`](../../init.md) §12–§13, §26. This was the last of the six phases in `init.md` §26 — all phases are now implemented (see `docs/features/README.md`'s index).

## 1) What This Feature Is

Wires `git commit`, `git merge`/`git pull`, and `git checkout` (branch switches) in a registered project's repo to automatically trigger `ragbuddy sync <project>` via `post-commit`/`post-merge`/`post-checkout` hooks, without ever breaking the developer's Git workflow.

- Spec: [`../../init.md`](../../init.md) §12 (Git Commit Auto Sync), §13 (Git Hook Installation)
- Implementation: `src/git/hook-installer.ts`, `src/cli/hook-command.ts`, `src/cli/{args,index}.ts` (extended for the `hook` command)

## 2) Flow / Behavior

```
edit docs → git commit / git pull (merge) / git checkout <branch>
          → post-commit / post-merge / post-checkout
          → ragbuddy sync → Qdrant updated
```

`ragbuddy hook install <project>`:
1. Validate the Git repository
2. Create/update `.git/hooks/post-commit`, `.git/hooks/post-merge`, and `.git/hooks/post-checkout`, each launching `ragbuddy sync <project>` **in the background** (`nohup ... &`, output redirected to `.git/ragbuddy-sync.log`) so the underlying `git commit`/`git merge`/`git checkout` returns immediately instead of waiting for embedding to finish
3. If any of those hooks already exists, chain into it rather than overwriting it
4. `post-checkout` additionally guards on Git's branch-flag argument (`$3 = 1`) so it only fires on an actual branch switch, not a single-file checkout (`git checkout -- file`)

### Background sync (2026-08-15)

The hook originally ran `ragbuddy sync` synchronously — the git operation blocked until embedding finished, which could take seconds on a large doc change. The hook block now backgrounds the sync with `nohup env RAGBUDDY_TRIGGER=hook ELECTRON_RUN_AS_NODE=1 "<node>" "<cli>" sync <project> > "<gitDir>/ragbuddy-sync.log" 2>&1 &` followed by `disown`, and prints `[ragbuddy] Sync launched in background (log: <path>)` immediately. The git operation itself is never blocked, and both success output and any failure warning land in the log file instead of the terminal (since nothing is left waiting to read it synchronously) — check `.git/ragbuddy-sync.log` in the project's repo to see the outcome of the last auto-sync.

`ragbuddy hook uninstall <project>` removes the chained call from all three hook files (restoring any prior hook content).

### Scheduled re-sync fallback (`ragbuddy sync-all`, 2026-08-13)

The git hook is the primary mechanism, but it has no safety net of its own: a project re-cloned onto a new machine, or one where the hook was never installed or got accidentally removed, silently drifts out of sync with no signal that anything is wrong. `ragbuddy sync-all` (`src/cli/sync-all-command.ts`) is a plain CLI command — not an internal scheduler — meant to be invoked periodically by whatever job runner the host already has (cron, systemd timer, Windows Task Scheduler). It:

1. Lists every registered project (`registry.list()`).
2. Calls the same `syncProject` + `recordRun` path `ragbuddy sync <project>` already uses, once per project, in sequence.
3. Isolates failures per project — one project throwing (Qdrant down, repo path gone) is recorded and skipped, never aborting the rest, mirroring the same resilience principle the git hook itself follows (§ above: a sync failure must never break the underlying operation, here "the rest of the batch" instead of "the commit").
4. Prints a per-project summary line and a final `Synced N project(s), M failure(s).`, setting a non-zero exit code if any project failed — so a cron job's own failure alerting (email on non-zero exit, log scraping, etc.) picks it up without ragbuddy needing its own notification system.

No internal timer/daemon was added — `ragbuddy web` stays a plain HTTP server with no background scheduling loop. Scheduling is the host's job; `ragbuddy sync-all` is just the syncable unit.

## 3) Domain & Data

No new data — this feature is purely operational glue around [incremental sync](./03-incremental-sync.md). All three hooks call the same `ragbuddy sync <project>`, which is already incremental (hash-diff) — firing more often costs nothing extra for unchanged files.

## 4) UI

Web dashboard: `HookToggle` (`web/src/components/hook-toggle.tsx`) shows one switch for all three hooks together — `isHookInstalled` treats `post-commit` as representative of the group since they are always installed/removed together.

## 5) Edge Cases & Rules

- Every hook must catch and warn on failures (Qdrant down, embedding provider down, ragbuddy unavailable) and still let the underlying Git operation succeed (`init.md` §12) — since the sync now runs in the background, the warning is written to `.git/ragbuddy-sync.log` rather than the terminal
- The sync process itself must never create another commit (no recursive Git operations) (`init.md` §12)
- Installing must never destroy a pre-existing user `post-commit`/`post-merge`/`post-checkout` hook (`init.md` §13)
- `post-checkout` fires on every checkout, including single-file (`git checkout -- file.md`) — the branch-flag guard (`$3 = 1`) prevents a sync on those
- **The hook's own invocation always sets `ELECTRON_RUN_AS_NODE=1`**, unconditionally — a no-op for a real `node` binary, but required whenever `nodePath` is actually the packaged Electron executable (true whenever the hook was installed from inside the desktop app: `process.execPath` there always reports Electron's own binary path, never a plain Node one). Without it, every commit/merge/checkout would relaunch the full Electron GUI instead of running the sync headlessly — see [2026-08-13_electron-hook-launches-gui.md](../issue/2026-08-13_electron-hook-launches-gui.md).

## Related Files

- `src/cli/sync-all-command.ts` — `runSyncAllCommand`: the scheduled re-sync fallback (2026-08-13)
- `src/git/hook-installer.ts` — `installHook`/`uninstallHook`: marker-delimited block written into `.git/hooks/{post-commit,post-merge,post-checkout}`, bakes in an absolute path to this installation's `dist/cli/index.js` (no reliance on `ragbuddy` being on `PATH`, since this is a local dev tool, not a globally published package)
- `src/cli/hook-command.ts` — `runHookCommand`: registry lookup + delegate, mirrors `ingest-command.ts`/`sync-command.ts`/`search-command.ts`
- `src/cli/args.ts`, `src/cli/index.ts` — extended for `hook install|uninstall <project>`
- `web/src/components/hook-toggle.tsx`, `src/server/routes/hook.ts` — web dashboard toggle + REST endpoints for the same install/uninstall
- Manually verified end-to-end (not just unit-tested): installed the hooks in a scratch repo, made a real commit with `QDRANT_URL`/`EMBEDDING_PROVIDER` pointing at unreachable services — the hook printed `[ragbuddy] Sync launched in background (log: ...)` and the commit returned immediately (`git commit` exit code 0); the failure warning appeared in `.git/ragbuddy-sync.log` once the backgrounded process finished
- Spec source: [`../../init.md`](../../init.md) §12, §13

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [03-incremental-sync.md](./03-incremental-sync.md)
