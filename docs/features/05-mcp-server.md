# MCP Server

**Status: Implemented** (Phase 5 — MCP). Traced from [`../../init.md`](../../init.md) §14–§15, §26.

## 1) What This Feature Is

The single MCP server (`project-rag mcp`) that Claude Code, OpenCode, and Codex all connect to — the same implementation for every agent, no per-agent RAG logic (`init.md` §28).

- Spec: [`../../init.md`](../../init.md) §14 (MCP Server), §15 (MCP Project Detection)
- Implementation: `src/mcp/server.ts`, `src/mcp/tools/{search-project-docs,get-project-document,list-project-knowledge}.ts`, `src/mcp/tool-result.ts`, `src/mcp/document-reader.ts`, `src/projects/project-resolver.ts`, `src/cli/{args,index}.ts` (extended for the `mcp` command)

## 2) Flow / Behavior

Three tools:
- `search_project_docs({ query, project? })` → delegates to [retrieval](./04-retrieval-search.md), returns `{ file, section, score, content }[]`, concise (not full documents)
- `get_project_document({ file, project? })` → returns document/section content; rejects path traversal and out-of-repo paths
- `list_project_knowledge({ project? })` → lists indexed docs for the resolved project

Project resolution: current working directory matched against registered repository paths; explicit `project` param always allowed as override; ambiguous cwd match → explicit error, never a guess (`init.md` §15).

## 3) Domain & Data

- No new data model — reuses the project registry and Qdrant-backed retrieval
- Must validate all tool parameters (`init.md` §21.10)

## 4) UI

Not applicable — MCP protocol only, consumed by coding agents' own UIs.

## 5) Edge Cases & Rules

- `get_project_document` rejects `../../etc/passwd`-style traversal AND any file outside the project's configured documentation `paths` — stricter than just "inside the repo": a direct filesystem read bypasses the ingestion scanner's own exclusion rules (`.env`, non-`docs/` files), so `document-reader.ts` re-applies an equivalent boundary itself (`init.md` §14, §21.3, §21.6). One deliberate exception mirrors the scanner's own: the repository root's `README.md` (case-insensitive) is readable even when `paths` doesn't include it — see [02-ingestion-full-index.md §3](./02-ingestion-full-index.md#3-domain--data). A README in a nested directory gets no such exception and still needs to fall inside a configured path.
- Cross-project access must be impossible even via crafted parameters — enforced by `resolveProject` requiring either an explicit registered `project` id or an unambiguous cwd match (`init.md` §21.7)
- Do not expose API keys in logs or unnecessary absolute paths in responses (`init.md` §21.8–21.9) — none of the three tools' responses include `absolute_path`
- Ambiguous or unmatched cwd → explicit error naming the conflicting project ids (or "no registered project"), never a silent guess (`init.md` §15)

## Related Files

- `src/projects/project-resolver.ts` — `resolveProject`: explicit `project` argument wins, otherwise matches the cwd against registered repositories
- `src/mcp/document-reader.ts` — `getProjectDocument`: path-traversal-safe, scoped to configured documentation paths
- `src/mcp/tool-result.ts` — `toolText`/`toolError`: shared MCP result-shape helpers
- `src/mcp/tools/search-project-docs.ts`, `get-project-document.ts`, `list-project-knowledge.ts` — the three tool registrations
- `src/mcp/server.ts` — `createMcpServer`: assembles the server and registers all three tools
- Spec source: [`../../init.md`](../../init.md) §14, §15, §28

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- API/Tool conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
- Depends on: [01-project-registry-and-multi-project-support.md](./01-project-registry-and-multi-project-support.md), [04-retrieval-search.md](./04-retrieval-search.md)
