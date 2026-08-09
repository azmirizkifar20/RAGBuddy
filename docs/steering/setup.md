# Setup & Running

How to run, debug, and work on this project locally. All commands below are real and working — see the root [`README.md`](../../README.md) for the narrative walkthrough; this doc is the quick-reference version.

## Prerequisites

- Node.js 18+ (developed on Node 24) + npm
- Docker + Docker Compose (for Qdrant — `docker-compose.yml` at the repo root)
- Optional: Ollama running locally if using the Ollama embedding provider (`EMBEDDING_PROVIDER=ollama`, the default)

## Install & Configure

1. `npm install`
2. `cp .env.example .env` and fill required vars (see [system-flow.md](./system-flow.md) Environment & Config section)
3. Create `config/projects.json` (see `config/projects.example.json`) with at least one registered project
4. `docker compose up -d` to start Qdrant

## Run

- Register a project: edit `config/projects.json` directly (id, name, absolute `repository` path, `paths` array — default `["docs"]`)
- Full index: `ragbuddy ingest <project>`
- Incremental sync: `ragbuddy sync <project>`
- Search: `ragbuddy search <project> "<query>"`
- Install Git hook: `ragbuddy hook install <project>` (`hook uninstall <project>` to remove)
- Start MCP server: `ragbuddy mcp`
- Build: `npm run build` (compiles `src/` → `dist/`, via `tsconfig.build.json`)
- Typecheck: `npm run typecheck`
- Tests: `npm test` (Vitest; 280 tests across all suites as of this writing)

Once built, `ragbuddy` is also usable as a global command via `npm link` from this directory (`package.json`'s `bin` field points at `dist/cli/index.js`); until then, invoke it directly as `node dist/cli/index.js <command>`.

## Debug

- Structured logs: `[INFO]` lines from `ingest`/`sync`/hook runs (via the `onLog` callback wired in `src/cli/index.ts`), `[ragbuddy] Error: ...` on failure
- Common issues to check: Qdrant reachability (`QDRANT_URL`, `docker compose ps`), embedding provider reachability (`EMBEDDING_BASE_URL`, is Ollama/the OpenAI-compatible endpoint actually running), registry path correctness (`PROJECT_REGISTRY_PATH`)
- `ingest`/`sync` refuse to run (rather than silently wiping a project's index) if the registered `repository` path is missing or isn't a Git repo — see `src/ingestion/indexer.ts`/`src/ingestion/sync.ts`'s liveness guard
- See the root [`README.md`](../../README.md#troubleshooting) for a fuller troubleshooting list

## DB / Tooling Access

- Qdrant runs via Docker Compose (`docker-compose.yml`), exposing REST on `6333` and gRPC on `6334`; no local DB credentials needed for the vector store itself
- Qdrant is a rebuildable index only — if deleted (`docker compose down -v`), `docker compose up -d` then `ragbuddy ingest <project>` for every registered project rebuilds the complete index from Git
