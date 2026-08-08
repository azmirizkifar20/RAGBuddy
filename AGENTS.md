## Skills Auto-Load

Before implementing any feature, change, extension, or refactoring task, ALWAYS check and load the appropriate skill:
- For feature work (implement, add, create, change, extend, refactor): Load `project-rag-feature-flow` skill first
- The skill defines the required workflow: read docs → trace runtime path → add/update tests when they protect the change → verify → update/create docs

When the user asks for any code change (implement, add, fix, refactor), ALWAYS load `project-rag-feature-flow` before touching code — regardless of task size.

## Documentation Structure

This project uses structured documentation under `docs/`:
- `docs/features/` - Current-state (and planned) feature documentation
- `docs/steering/` - Technical architecture and stack decisions
- `docs/issue/` - Bug reports and root cause analysis

There is no `docs/design-system/` folder — the `web/` frontend is a small internal dashboard (Vite + React + Tailwind + shadcn/ui), not a design-system-driven product UI.

## Project Status

`project-rag` is fully implemented: all six phases from `init.md` §26 (Foundation, Full Ingestion, Incremental Sync, Retrieval, MCP Server, Git Hook Auto Sync) plus the web frontend + CLI `project` subcommands (`docs/features/07-web-frontend-and-project-cli.md`). `docs/features/*.md` describe shipped, current-state behavior — see `docs/features/README.md` for the full index.
