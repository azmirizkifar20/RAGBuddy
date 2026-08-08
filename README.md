# project-rag

A multi-project RAG (Retrieval-Augmented Generation) service that gives coding agents — **Claude Code**, **OpenCode**, **Codex**, or any other MCP-compatible agent — semantic search over your projects' documentation.

## What it is

`project-rag` indexes the `docs/` folder (configurable) of one or more registered Git repositories into [Qdrant](https://qdrant.tech), a vector database, and exposes that index through both a CLI and an MCP server. A coding agent working in your repo can call `search_project_docs` to find the architecture doc, feature spec, or issue writeup relevant to what it's doing right now — instead of relying on whatever happened to fit in its context window.

## Why it exists

Coding agents work best when they can find the *right* project documentation without a human pasting it in. `project-rag` treats each registered repository's Git history as the single source of truth: the vector index in Qdrant is just a cache. If Qdrant is wiped, `project-rag ingest <project>` rebuilds the complete index from the files on disk — nothing is ever stored only in the vector database.

## Architecture

```
Git Repository (project-a, project-b, ...)
        ↓ scan configured doc paths
   Ingestion (scanner → hasher → chunker)
        ↓
   Embedding Provider (Ollama / OpenAI-compatible)
        ↓
   Qdrant (project_rag_documents, payload-filtered by `project`)
        ↓
   Retrieval (project-filtered similarity search)
        ↓
   MCP Server  ←→  Claude Code / OpenCode / Codex
        ↑
       CLI (ingest / sync / search / hook / mcp)
```

Every project registered with `project-rag` is isolated by a `project` field in Qdrant's payload metadata — a search against one project can never return another project's documents, enforced at the retrieval layer itself, not left to the LLM.

Full details: [`docs/steering/architecture.md`](docs/steering/architecture.md) (layers & components), [`docs/steering/system-flow.md`](docs/steering/system-flow.md) (request lifecycles), [`docs/features/`](docs/features/README.md) (what each feature does, traced to real code).

## Installation

Prerequisites: Node.js 18+ (developed on Node 24), npm, Docker (for Qdrant), and optionally [Ollama](https://ollama.com) if you want local embeddings.

```bash
git clone <this-repository>
cd project-rag
npm install
npm run build
cp .env.example .env
```

Edit `.env` to taste (defaults work for a local Ollama + Docker Compose Qdrant setup — see below).

## Qdrant setup

`project-rag` needs a running Qdrant instance. The included `docker-compose.yml` starts one on `localhost:6333`:

```bash
docker compose up -d
```

`project-rag`'s Node.js process itself runs directly on the host (not containerized) — it needs filesystem access to every registered Git repository, which is simplest to guarantee by not putting it in a container. A future production deployment could containerize it too, by mounting each registered project's directory into the container.

## Embedding configuration

`project-rag` is embedding-provider-agnostic via a small `EmbeddingProvider` interface (`src/embedding/embedding-provider.ts`). Two providers ship today:

**Local (Ollama)** — no data leaves your machine:

```env
EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=bge-m3
```

Pull the model first: `ollama pull bge-m3`.

**OpenAI-compatible API:**

```env
EMBEDDING_PROVIDER=openai
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-...
```

`EMBEDDING_BASE_URL` also works with any OpenAI-compatible endpoint (self-hosted vLLM, LM Studio, etc.) — omit `EMBEDDING_API_KEY` if the endpoint doesn't require one.

`project-rag` never assumes you want documentation sent to a cloud provider — Ollama is the default in `.env.example`.

## Project registration

`project-rag` supports multiple projects from one installation. Each project is a registered Git repository plus the doc paths inside it to index (default `["docs"]`). Registration is currently done by editing the JSON file at `PROJECT_REGISTRY_PATH` (default `./config/projects.json`; see `config/projects.example.json`):

```json
{
  "projects": [
    { "id": "bidubadu", "name": "Bidubadu", "repository": "/home/you/projects/bidubadu", "paths": ["docs"] }
  ]
}
```

`repository` must be an absolute path to a Git repository (a `.git` directory must exist inside it). Details: [`docs/features/01-project-registry-and-multi-project-support.md`](docs/features/01-project-registry-and-multi-project-support.md).

## Initial ingestion

Full rebuild of a project's index — always safe to re-run, always rebuilds from the files on disk:

```bash
project-rag ingest bidubadu
```

This scans the project's configured paths, chunks every markdown file (heading-aware, so a chunk keeps its title/section context), embeds every chunk, and replaces the project's entire vector set in Qdrant. Details: [`docs/features/02-ingestion-full-index.md`](docs/features/02-ingestion-full-index.md).

## Incremental sync

After the first `ingest`, use `sync` day-to-day — it only re-embeds what actually changed, by comparing content hashes already stored in Qdrant against the files on disk:

```bash
project-rag sync bidubadu
```

```
Project: bidubadu

Added:
  docs/features/04-voucher.md

Modified:
  docs/steering/architecture.md

Deleted:
  docs/issue/old-login.md

Skipped:
  docs/README.md

Summary:
  Added: 1
  Modified: 1
  Deleted: 1
  Unchanged: 8
```

Details: [`docs/features/03-incremental-sync.md`](docs/features/03-incremental-sync.md).

## Git hook setup

Wire `sync` to run automatically after every commit, so the index never drifts from what's actually on disk:

```bash
project-rag hook install bidubadu
```

This installs (or safely chains onto an existing) `.git/hooks/post-commit` in the project's repository. **A sync failure never blocks your commit** — if Qdrant or the embedding provider is down, the hook prints a warning and your commit still succeeds:

```
[project-rag] Sync started...
[project-rag] Warning: RAG sync failed (fetch failed). Git commit remains successful.
```

Remove it with `project-rag hook uninstall bidubadu`. Details: [`docs/features/06-git-hook-auto-sync.md`](docs/features/06-git-hook-auto-sync.md).

## MCP setup for Claude Code

Add `project-rag` as an MCP server. From your terminal, in any registered project's directory (or anywhere, if you'll pass an explicit project id per call):

```bash
claude mcp add project-rag -- node /absolute/path/to/project-rag/dist/cli/index.js mcp
```

Or add it directly to your Claude Code MCP config:

```json
{
  "mcpServers": {
    "project-rag": {
      "command": "node",
      "args": ["/absolute/path/to/project-rag/dist/cli/index.js", "mcp"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "EMBEDDING_PROVIDER": "ollama",
        "EMBEDDING_MODEL": "bge-m3",
        "PROJECT_REGISTRY_PATH": "/absolute/path/to/project-rag/config/projects.json"
      }
    }
  }
}
```

Claude Code will then have `search_project_docs`, `get_project_document`, and `list_project_knowledge` available. Project resolution is automatic from Claude Code's working directory — pass an explicit `project` argument only if you need to query a different project than the one you're standing in.

## MCP setup for OpenCode

Same server, same three tools — `project-rag` intentionally has one MCP implementation shared by every agent (`init.md` §28), not a separate integration per client. Add it to OpenCode's MCP server configuration the same way, pointing at the same `node .../dist/cli/index.js mcp` command and env vars as above. Check OpenCode's own docs for its exact config file location/format; the server side is identical.

## Troubleshooting

- **`[project-rag] Error: Project "<id>" is not registered`** — the project id doesn't exist in the registry at `PROJECT_REGISTRY_PATH`. Check the file and the id you're passing.
- **`Repository is not accessible or not a Git repository`** — the registered `repository` path moved, was deleted, or its `.git` folder is missing. `ingest`/`sync` refuse to run rather than silently treating "no files found" as "everything was deleted."
- **`Failed to obtain server version. Unable to check client-server compatibility.`** — Qdrant isn't reachable at `QDRANT_URL`. Check `docker compose ps` / `docker compose up -d`. This warning is otherwise harmless.
- **Embedding request errors (`fetch failed`, timeouts)** — check `EMBEDDING_PROVIDER`/`EMBEDDING_BASE_URL`/`EMBEDDING_MODEL` and that the provider (Ollama or your OpenAI-compatible endpoint) is actually running and has the model available.
- **A registered project's `paths` isn't `docs`** — `ingest`/`sync`/`get_project_document` all scope correctly to whatever `paths` you registered, not just `docs/`; double-check `config/projects.json` if search results look empty.
- More: [`docs/steering/setup.md`](docs/steering/setup.md).

## Rebuilding Qdrant from Git

Qdrant is only a cache — the complete index is always reconstructable from the registered Git repositories:

```bash
docker compose down -v   # wipes the qdrant_storage volume
docker compose up -d
project-rag ingest <project-id>   # repeat for every registered project
```

## Documentation map

- [`docs/steering/`](docs/steering/README.md) — architecture, tech stack, routing, system flow, API/tool conventions, setup
- [`docs/features/`](docs/features/README.md) — one doc per feature, traced to real files, one file per `init.md` phase
- [`docs/issue/`](docs/issue/README.md) — bug reports and root cause analysis
- [`init.md`](init.md) — the original build specification this project was implemented against

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # compiles src/ to dist/
```

See [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) for the coding-agent workflow used to build and extend this project.
