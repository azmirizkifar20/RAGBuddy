# Routing Structure

## Overview

`project-rag` is not a web app — it has no HTTP routes. "Routing" here means the two entry surfaces coding agents and developers use: the **CLI** command tree and the **MCP tool** dispatch. Both are fully implemented, specified in [`../../init.md`](../../init.md) §14 and §18.

## CLI Commands (`init.md` §18, `src/cli/args.ts` + `src/cli/index.ts`)

| Command | Purpose | Handler |
|---------|---------|---------|
| `project-rag ingest <project>` | Full rebuild of a project's index | `src/cli/ingest-command.ts` → `src/ingestion/indexer.ts` |
| `project-rag sync <project>` | Incremental sync (added/modified/deleted/unchanged) | `src/cli/sync-command.ts` → `src/ingestion/sync.ts` |
| `project-rag search <project> "<query>"` | Query a project's indexed docs | `src/cli/search-command.ts` → `src/retrieval/search.ts` |
| `project-rag hook install <project>` | Install the Git post-commit sync hook | `src/cli/hook-command.ts` → `src/git/hook-installer.ts` |
| `project-rag hook uninstall <project>` | Remove the Git post-commit sync hook | `src/cli/hook-command.ts` → `src/git/hook-installer.ts` |
| `project-rag mcp` | Start the MCP server (stdio transport) | `src/cli/index.ts` → `src/mcp/server.ts` |

`project-rag search` accepts a multi-word query with or without shell quoting (`src/cli/args.ts` joins all trailing argv entries). There is no `project register`/`project list`/`project remove` CLI command yet — projects are registered by editing `config/projects.json` directly (`src/projects/project-registry.ts` provides the underlying `register`/`list`/`remove`/`find` API, used internally and by tests, but isn't yet exposed as its own CLI subcommand).

## MCP Tool Routing (`init.md` §14, `src/mcp/server.ts` + `src/mcp/tools/`)

| Tool | Purpose | Handler |
|------|---------|---------|
| `search_project_docs` | Semantic search over a project's indexed docs, filtered by `project` | `src/mcp/tools/search-project-docs.ts` |
| `get_project_document` | Return a specific document's content, path-traversal-safe and scoped to the project's configured doc paths | `src/mcp/tools/get-project-document.ts` |
| `list_project_knowledge` | List indexed documents for the current/target project | `src/mcp/tools/list-project-knowledge.ts` |

Project resolution for MCP calls (current working directory → registered repository path, explicit `project` param as fallback, ambiguous match → error) is implemented in `src/projects/project-resolver.ts` per `init.md` §15.
