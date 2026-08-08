# Routing Structure

## Overview

`project-rag` is not a web app — it has no HTTP routes. "Routing" here means the two entry surfaces coding agents and developers use: the **CLI** command tree and the **MCP tool** dispatch. Both are specified in [`../../init.md`](../../init.md) §14 and §18; neither is implemented yet.

## CLI Commands (planned — `init.md` §18)

| Command | Purpose |
|---------|---------|
| `project-rag project list` | List registered projects |
| `project-rag project register <id> <repository>` | Register a project/repository |
| `project-rag project remove <id>` | Remove a registered project |
| `project-rag ingest <project>` | Full rebuild of a project's index |
| `project-rag sync <project>` | Incremental sync (added/modified/deleted docs) |
| `project-rag search <project> "<query>"` | Query a project's indexed docs |
| `project-rag hook install <project>` | Install the Git post-commit sync hook |
| `project-rag hook uninstall <project>` | Remove the Git post-commit sync hook |
| `project-rag mcp` | Start the MCP server |

Planned handler location: `src/cli/` (see [architecture.md](./architecture.md)).

## MCP Tool Routing (planned — `init.md` §14)

| Tool | Purpose |
|------|---------|
| `search_project_docs` | Semantic search over a project's indexed docs, filtered by `project` |
| `get_project_document` | Return a specific document/section, path-traversal-safe |
| `list_project_knowledge` | List indexed documents for the current/target project |

Planned handler location: `src/mcp/tools/` (see [architecture.md](./architecture.md)).

Project resolution for MCP calls (current working directory → registered repository path, explicit `project` param as fallback, ambiguous match → error) is specified in `init.md` §15.
