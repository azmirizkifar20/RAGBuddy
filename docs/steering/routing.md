# Routing Structure

## Overview

`project-rag` has three entry surfaces: the **CLI** command tree, the **MCP tool** dispatch, and the **web dashboard** served over HTTP. The CLI and MCP are fully implemented, specified in [`../../init.md`](../../init.md) §14 and §18; the HTTP layer is added by the web features (see below).

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
| `get_project_context` | Compact orientation overview (identity, Git status, tech-stack/architecture/system-flow summaries, doc inventory) — meant to run before deeper exploration | `src/mcp/tools/get-project-context.ts` |
| `search_project_docs` | Semantic search over a project's indexed docs, filtered by `project` | `src/mcp/tools/search-project-docs.ts` |
| `get_project_document` | Return a specific document's content, path-traversal-safe and scoped to the project's configured doc paths | `src/mcp/tools/get-project-document.ts` |
| `list_project_knowledge` | List indexed documents for the current/target project | `src/mcp/tools/list-project-knowledge.ts` |

Project resolution for MCP calls (current working directory → registered repository path, explicit `project` param as fallback, ambiguous match → error) is implemented in `src/projects/project-resolver.ts` per `init.md` §15.

## Web HTTP Routing (`src/server/app.ts` + `src/server/routes/`, started by `project-rag web`)

The web dashboard serves the `web/` React SPA statically and exposes a REST+SSE API under `/api`. Routes are registered in `src/server/app.ts`; handlers live in `src/server/routes/`.

| Route | Purpose | Handler |
|-------|---------|---------|
| `GET /` | List registered projects | `routes/projects.ts` |
| `GET /:id` | Single project detail | `routes/projects.ts` |
| `POST /` / `DELETE /:id` | Register / remove a project | `routes/projects.ts` |
| `GET /:id/knowledge` | Indexed documents for a project | `routes/knowledge.ts` |
| `GET /:id/history` | Sync history for a project | `routes/history.ts` |
| `GET /:id/uploads` / `POST /:id/uploads` / `DELETE /:id/uploads/:filename` | Uploaded-document listing, upload, delete | `routes/uploads.ts` |
| `POST /:id/search` | Search a project's docs | `routes/search.ts` |
| `POST /:id/ingest` / `POST /:id/sync` | Full rebuild / incremental sync | `routes/ingest.ts`, `routes/sync.ts` |
| `POST /:id/chat` | **Streaming chat** over SSE (`event: token` / `sources` / `error` / `done`), with optional RAG and auto-compaction | `routes/chat.ts` |
| `POST /:id/hook` / `DELETE /:id/hook` | Install / remove the Git post-commit hook | `routes/hook.ts` |

All of the above are mounted under `/api/projects` in `src/server/app.ts`. Separate top-level routes: `GET /api/config` (runtime config, incl. `CHAT_CONTEXT_LIMIT`), `GET /api/activity` (activity feed), and `GET /api/fs/...` (filesystem browsing for the folder picker).

SSE events are written via `src/server/sse.ts` (`startSse` + `sendSseEvent`). Chat streaming uses the same SSE transport.
