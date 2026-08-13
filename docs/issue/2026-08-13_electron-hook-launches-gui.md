# Electron App Pops Open on Every Commit in a Registered Project

**Reported**: "cek apps electron selalu tiba tiba open saat ada commit di salah satu project" — the packaged Electron app's window suddenly opens whenever a commit happens in any registered project, with no user action.

## Root Cause

Traced the actual code path (not the reported symptom) end to end:

1. Enabling the auto-sync hook from the dashboard (`HookToggle`) calls `POST /api/projects/:id/hook` → `src/server/routes/hook.ts:13` → `installHook(project.repository, project.id)` with **no** explicit `nodePath`/`cliEntrypoint`.
2. `installHook` (`src/git/hook-installer.ts:34`) then defaults `nodePath = process.execPath`, evaluated **inside whatever process is currently running the Express server**.
3. When that process is the backend spawned by the packaged Electron app (`electron/main.js`), `process.execPath` is **always** the Electron executable's own path (e.g. `...\win-unpacked\RAGBuddy.exe`) — this is true regardless of the `ELECTRON_RUN_AS_NODE` env var, which only changes a process's *runtime behavior*, never what `process.execPath` itself reports.
4. So the generated `.git/hooks/{post-commit,post-merge,post-checkout}` for that project ended up literally:
   ```sh
   RAGBUDDY_TRIGGER=hook "...\RAGBuddy.exe" "...\backend\cli\index.js" sync <project> || echo "..."
   ```
   — with **no** `ELECTRON_RUN_AS_NODE=1` baked into the hook script itself (that variable only ever existed inside `main.js`'s own `spawn()` call for its backend child, never propagated into the persisted hook file).
5. Running `RAGBuddy.exe <args>` with no `ELECTRON_RUN_AS_NODE` launches the full Electron app — `main.js` never inspects `argv` at all, it unconditionally calls `startBackend()` + `createWindow()` on `app.whenReady()`. Every commit/merge/checkout in that project therefore silently relaunched the whole desktop app.

Confirmed by reading `installHook`'s default, `main.js`'s spawn call, and the hook block builder together — not by guessing; each of the three steps above is a direct code reference.

## Fix

`buildHookBlock` (`src/git/hook-installer.ts`) now always prefixes the sync invocation with `ELECTRON_RUN_AS_NODE=1`, unconditionally:

```sh
RAGBUDDY_TRIGGER=hook ELECTRON_RUN_AS_NODE=1 "$nodePath" "$cliEntrypoint" sync <project> || ...
```

This is a no-op for a real `node` binary (unrecognized env vars are ignored) but makes the hook run headlessly even when `nodePath` happens to be the Electron executable — matching exactly how `main.js` already spawns its own backend child.

Covered by a new test in `tests/git/hook-installer.test.ts` asserting `ELECTRON_RUN_AS_NODE=1` is present on every generated hook line, for both real-Node and Electron-shaped paths.

## Action Required on Already-Installed Hooks

**This fix only affects hooks installed after this change.** Any project whose auto-sync hook was already enabled from inside the packaged Electron app still has the old, broken script on disk — the bug will keep happening for those projects until the hook is reinstalled: toggle the auto-sync switch off then on again in the dashboard (or run `ragbuddy hook uninstall <project>` then `ragbuddy hook install <project>`) after rebuilding/repackaging with this fix.

## Related Files

- `src/git/hook-installer.ts` — `buildHookBlock`, the fix
- `src/server/routes/hook.ts` — the route that calls `installHook` with no explicit options, the trigger for the default-`process.execPath` path
- `electron/main.js` — where the packaged backend is spawned, and the only place `ELECTRON_RUN_AS_NODE=1` previously existed
- `tests/git/hook-installer.test.ts` — regression test

## Cross-References

- Feature doc: [../features/06-git-hook-auto-sync.md](../features/06-git-hook-auto-sync.md)
- Electron shell: [../features/11-electron-desktop-app.md](../features/11-electron-desktop-app.md)
