# Setup & Running

How to run, debug, and work on this project locally. **Status: planned** — nothing is scaffolded yet; this documents the setup [`../../init.md`](../../init.md) specifies for Phase 1 onward.

## Prerequisites

- Node.js (LTS) + npm
- Docker + Docker Compose (for Qdrant — `init.md` §20)
- Optional: Ollama running locally if using the Ollama embedding provider (`EMBEDDING_PROVIDER=ollama`)

## Install & Configure (planned)

1. `npm install` (once `package.json` exists)
2. Copy `.env.example` → `.env` and fill required vars (see [system-flow.md](./system-flow.md) Environment & Config section)
3. Create `config/projects.yaml` (or the chosen registry format) with at least one registered project (`init.md` §5)
4. `docker compose up -d` to start Qdrant

## Run (planned)

- Register a project: `project-rag project register <id> <repository>`
- Full index: `project-rag ingest <project>`
- Incremental sync: `project-rag sync <project>`
- Search: `project-rag search <project> "<query>"`
- Install Git hook: `project-rag hook install <project>`
- Start MCP server: `project-rag mcp`
- Tests: Vitest — exact command TBD once `package.json` exists (expected `npm test` / `npx vitest run`)

## Debug

- Structured logs per `init.md` §22 (`[INFO]`/`[WARN]`/`[ERROR]` with enough context to debug — e.g. sync summaries, Qdrant/embedding errors)
- Common issues to check once implemented: Qdrant reachability (`QDRANT_URL`), embedding provider reachability, registry path correctness

## DB / Tooling Access

- Qdrant runs via Docker Compose; no local DB credentials needed for the vector store itself
- Qdrant is a rebuildable index only — if deleted, re-run `project-rag ingest <project>` for every registered project to rebuild from Git (`init.md` §1, §24)
