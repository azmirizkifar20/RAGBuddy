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

There is no `docs/design-system/` folder — `project-rag` is a backend service (CLI + MCP server), it has no UI layer.

## Project Status

`project-rag` is currently at the **specification stage**. The full build spec lives in [`init.md`](./init.md) at the repo root. No application source code exists yet — `docs/features/*.md` describe the *planned* behavior traced from that spec, not shipped code. Implementation should proceed through the phases defined in `init.md` §26 (Foundation → Full Ingestion → Incremental Sync → Retrieval → MCP → Git Hook).
