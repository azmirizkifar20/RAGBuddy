# Project Registry & Multi-Project Support

**Status: Implemented** (Phase 1 — Foundation).

## 1) What This Feature Is

A registry of Git repositories `ragbuddy` is allowed to index, keyed by a project id. This is the foundation every other feature depends on: ingestion, sync, retrieval, and MCP tools all resolve "which project" through this registry before touching any files or vectors.

- Spec: [`../../init.md`](../../init.md) §5 (Multi-Project Support), §18 (CLI)
- Implementation: (see Related Files below)

## 2) Flow / Behavior

- `ragbuddy project register <id> <repository> --paths <path,...>` — validates the path is a Git repository, records `id`, `name`, `repository`, and `paths`. At least one path is required (2026-08-20) — registration is rejected with `At least one path to index is required` if omitted or empty, so a project can never silently end up indexing nothing or an unintended default.
- `ragbuddy project list` — lists registered projects
- `ragbuddy project remove <id>` — removes a registration (does not delete the repo)
- Every other command (`ingest`, `sync`, `search`, `hook install/uninstall`, MCP tools) resolves its target project through this registry before doing anything else

## 3) Domain & Data

- Registry format: JSON/YAML (simplest maintainable option, per `init.md` §5) at `PROJECT_REGISTRY_PATH` (`init.md` §19)
- Each entry: `id`, `name`, `repository` (absolute path), `paths` (non-empty list — required at registration, no default)
- No database — the registry file itself is the source of truth for "which projects exist"

## 4) UI

Not applicable — CLI only, no UI layer.

## 5) Edge Cases & Rules

- Duplicate project id on register → reject (`init.md` §23, test list)
- Repository path that doesn't exist or isn't a Git repo → reject with a clear error
- No `paths` (or an empty array) → reject with `At least one path to index is required` (2026-08-20) — enforced once in `ProjectRegistry.register`, so both the CLI and the web dashboard's "Add project" form share the same rule; the dashboard form's `paths` field is `required` client-side for the same reason
- MCP project auto-detection from cwd must error on ambiguous matches rather than guess (`init.md` §15)

## Related Files

- Spec source: [`../../init.md`](../../init.md) §5, §15, §18
- Implementation: `src/projects/project-registry.ts`, `src/projects/project-types.ts`, `web/src/components/add-project-modal.tsx` (dashboard "Add project" form — same required-`paths` rule, surfaced client-side)
- Tests: `tests/projects/project-registry.test.ts`

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Routing (CLI): [../steering/routing.md](../steering/routing.md)
