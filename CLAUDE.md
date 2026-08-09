## Skills Auto-Load

Before implementing any feature, change, extension, or refactoring task, ALWAYS check and load the appropriate skill:
- For feature work (implement, add, create, change, extend, refactor): Load `ragbuddy-feature-flow` skill first
- The skill defines the required workflow: read docs → trace runtime path → add/update tests when they protect the change → verify → update/create docs

When the user asks for any code change (implement, add, fix, refactor), ALWAYS load `ragbuddy-feature-flow` before touching code — regardless of task size.

## Documentation Structure

This project uses structured documentation under `docs/`:
- `docs/features/` - Current-state (and planned) feature documentation
- `docs/steering/` - Technical architecture and stack decisions
- `docs/issue/` - Bug reports and root cause analysis
- `docs/design-system/` - Tokens, motion and component conventions for the `web/` dashboard (Vite + React + Tailwind + shadcn/ui). It is a small internal tool, so this records the conventions it follows rather than prescribing a component library.

## Knowledge Retrieval Strategy (ragbuddy MCP)

Before implementing a non-trivial feature in this project:
  1. Use `get_project_context` first to understand the project (identity, Git status, tech stack/architecture summaries, doc inventory).
  2. Use `search_project_docs` for architecture, business rules, historical issues, conventions, and documented behavior.
  3. Use `get_project_document` to read a full doc found via search when a snippet isn't enough.
  4. Use `list_project_knowledge` to see everything currently indexed when orienting from scratch.
  5. Read the actual source code before making implementation decisions — treat it as the final authority for current behavior.

Don't force `get_project_context` for trivial tasks where it adds no value.

## Project Status

`RAGBuddy` is fully implemented: all six phases from `init.md` §26 (Foundation, Full Ingestion, Incremental Sync, Retrieval, MCP Server, Git Hook Auto Sync) plus the web frontend + CLI `project` subcommands (`docs/features/07-web-frontend-and-project-cli.md`) and the dashboard redesign with document uploads and sync history (`docs/features/08-dashboard-redesign-uploads-and-history.md`). `docs/features/*.md` describe shipped, current-state behavior — see `docs/features/README.md` for the full index.
