# MCP Server

**Status: Implemented** (Phase 5 — MCP). Traced from [`../../init.md`](../../init.md) §14–§15, §26.

## 1) What This Feature Is

The single MCP server (`ragbuddy mcp`) that Claude Code, OpenCode, and Codex all connect to — the same implementation for every agent, no per-agent RAG logic (`init.md` §28).

- Spec: [`../../init.md`](../../init.md) §14 (MCP Server), §15 (MCP Project Detection)
- Implementation: `src/mcp/server.ts`, `src/mcp/tools/{get-project-context,search-project-docs,get-project-document,list-project-knowledge}.ts`, `src/mcp/tool-result.ts`, `src/mcp/document-reader.ts`, `src/context/project-context.ts`, `src/projects/project-resolver.ts`, `src/cli/{args,index}.ts` (extended for the `mcp` command)

## 2) Flow / Behavior

Four tools:
- `get_project_context({ project? })` → compact orientation overview: project identity, Git branch/commit/dirty state, README + `docs/steering/*.md` summaries (truncated, not full documents), and a documentation inventory (total + counts by parent folder). Meant to run once before deeper exploration — it does not perform a vector search and is not a substitute for `search_project_docs`.
- `search_project_docs({ query, project? })` → delegates to [retrieval](./04-retrieval-search.md), returns `{ file, section, score, content }[]`, concise (not full documents)
- `get_project_document({ file, project? })` → returns document/section content; rejects path traversal and out-of-repo paths
- `list_project_knowledge({ project? })` → lists indexed docs for the resolved project

Project resolution: current working directory matched against registered repository paths; explicit `project` param always allowed as override; ambiguous cwd match → explicit error, never a guess (`init.md` §15). All four tools share the same `resolveProject` call — no separate detection logic for `get_project_context`.

`get_project_context` reads a fixed, well-known set of paths directly off disk (`README.md`, `docs/README.md`, `docs/steering/{tech-stack,architecture,system-flow,api-conventions}.md`) rather than scanning the repo — missing files are simply omitted from the response, never an error. Each present document is summarized (whitespace-collapsed, truncated to ~800 characters at a paragraph boundary where possible) rather than returned in full, per the "orientation, not a dump" requirement. The documentation inventory comes from `getIndexedFiles` (`src/qdrant/qdrant-repository.ts`), the same Qdrant-backed metadata `list_project_knowledge` uses — no second scanner. If Qdrant is unreachable, the inventory degrades to zero counts instead of failing the whole call; the rest of the context (README/steering summaries, Git status) is still returned.

## 3) Domain & Data

- No new data model — reuses the project registry and Qdrant-backed retrieval
- Must validate all tool parameters (`init.md` §21.10)

## 4) UI

Not applicable — MCP protocol only, consumed by coding agents' own UIs.

## 5) Edge Cases & Rules

- `get_project_document` rejects `../../etc/passwd`-style traversal AND any file outside the project's configured documentation `paths` — stricter than just "inside the repo": a direct filesystem read bypasses the ingestion scanner's own exclusion rules (`.env`, non-`docs/` files), so `document-reader.ts` re-applies an equivalent boundary itself (`init.md` §14, §21.3, §21.6). One deliberate exception mirrors the scanner's own: the repository root's `README.md` (case-insensitive) is readable even when `paths` doesn't include it — see [02-ingestion-full-index.md §3](./02-ingestion-full-index.md#3-domain--data). A README in a nested directory gets no such exception and still needs to fall inside a configured path.
- `get_project_context` reads a fixed constant list of relative paths, not caller input, so it doesn't need `document-reader.ts`'s traversal guard — there is no parameter through which a caller could redirect which files get read
- Cross-project access must be impossible even via crafted parameters — enforced by `resolveProject` requiring either an explicit registered `project` id or an unambiguous cwd match (`init.md` §21.7)
- Do not expose API keys in logs or unnecessary absolute paths in responses (`init.md` §21.8–21.9) — none of the four tools' responses include `absolute_path`; `get_project_context` reports `repository.name` (basename only)
- Ambiguous or unmatched cwd → explicit error naming the conflicting project ids (or "no registered project"), never a silent guess (`init.md` §15)
- A project with no Git history, no `docs/steering/` files, or an unreachable Qdrant still returns a valid `get_project_context` response — each missing piece is omitted (docs), flagged (`git: { available: false }`), or zeroed (`documentation.total: 0`), never a thrown error

## Related Files

- `src/projects/project-resolver.ts` — `resolveProject`: explicit `project` argument wins, otherwise matches the cwd against registered repositories
- `src/mcp/document-reader.ts` — `getProjectDocument`: path-traversal-safe, scoped to configured documentation paths
- `src/context/project-context.ts` — `buildProjectContext`: reads the fixed orientation docs, Git status, and the Qdrant-backed documentation inventory into one compact result
- `src/mcp/tool-result.ts` — `toolText`/`toolError`: shared MCP result-shape helpers
- `src/mcp/tools/get-project-context.ts`, `search-project-docs.ts`, `get-project-document.ts`, `list-project-knowledge.ts` — the four tool registrations
- `src/mcp/server.ts` — `createMcpServer`: assembles the server and registers all four tools
- Spec source: [`../../init.md`](../../init.md) §14, §15, §28

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- API/Tool conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
- Depends on: [01-project-registry-and-multi-project-support.md](./01-project-registry-and-multi-project-support.md), [04-retrieval-search.md](./04-retrieval-search.md)
