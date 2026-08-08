# Project Registry & Multi-Project Support

**Status: Planned** (Phase 1 — Foundation). Not yet implemented; traced from [`../../init.md`](../../init.md) §5, §18, §26.

## 1) What This Feature Is

A registry of Git repositories `project-rag` is allowed to index, keyed by a project id. This is the foundation every other feature depends on: ingestion, sync, retrieval, and MCP tools all resolve "which project" through this registry before touching any files or vectors.

- Spec: [`../../init.md`](../../init.md) §5 (Multi-Project Support), §18 (CLI)
- Planned files: `src/projects/project-registry.ts`, `src/projects/project-types.ts`

## 2) Flow / Behavior

- `project-rag project register <id> <repository>` — validates the path is a Git repository, records `id`, `name`, `repository`, and `paths` (default `docs/`)
- `project-rag project list` — lists registered projects
- `project-rag project remove <id>` — removes a registration (does not delete the repo)
- Every other command (`ingest`, `sync`, `search`, `hook install/uninstall`, MCP tools) resolves its target project through this registry before doing anything else

## 3) Domain & Data

- Registry format: JSON/YAML (simplest maintainable option, per `init.md` §5) at `PROJECT_REGISTRY_PATH` (`init.md` §19)
- Each entry: `id`, `name`, `repository` (absolute path), `paths` (list, default `["docs"]`)
- No database — the registry file itself is the source of truth for "which projects exist"

## 4) UI

Not applicable — CLI only, no UI layer.

## 5) Edge Cases & Rules

- Duplicate project id on register → reject (`init.md` §23, test list)
- Repository path that doesn't exist or isn't a Git repo → reject with a clear error
- MCP project auto-detection from cwd must error on ambiguous matches rather than guess (`init.md` §15)

## Related Files

- Spec source: [`../../init.md`](../../init.md) §5, §15, §18

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Routing (CLI): [../steering/routing.md](../steering/routing.md)
