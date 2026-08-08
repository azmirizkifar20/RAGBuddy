# MCP Server

**Status: Planned** (Phase 5 — MCP). Not yet implemented; traced from [`../../init.md`](../../init.md) §14–§15, §26.

## 1) What This Feature Is

The single MCP server (`project-rag mcp`) that Claude Code, OpenCode, and Codex all connect to — the same implementation for every agent, no per-agent RAG logic (`init.md` §28).

- Spec: [`../../init.md`](../../init.md) §14 (MCP Server), §15 (MCP Project Detection)
- Planned files: `src/mcp/server.ts`, `src/mcp/tools/{search-project-docs,get-project-document,list-project-knowledge}.ts`

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

- `get_project_document` must prevent `../../etc/passwd`-style traversal and any access outside the registered repository (`init.md` §14, §21.3, §21.6)
- Cross-project access must be impossible even via crafted parameters (`init.md` §21.7)
- Do not expose API keys in logs or unnecessary absolute paths in responses (`init.md` §21.8–21.9)

## Related Files

- Spec source: [`../../init.md`](../../init.md) §14, §15, §28

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- API/Tool conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
- Depends on: [01-project-registry-and-multi-project-support.md](./01-project-registry-and-multi-project-support.md), [04-retrieval-search.md](./04-retrieval-search.md)
