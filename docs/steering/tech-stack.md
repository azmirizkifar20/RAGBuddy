# Technology Stack

## Overview

Stack decisions per [`../../init.md`](../../init.md) §3, as actually installed (see `package.json`).

## Backend

- Node.js 24 + TypeScript 5.6 (CommonJS output — chosen over ESM to avoid `.js`-extension import friction; `tsconfig.json` for typecheck, `tsconfig.build.json` for the `dist/` build)
- npm (package manager)
- CLI: hand-rolled argv parsing (`src/cli/args.ts`) — no framework dependency for six commands
- `@modelcontextprotocol/sdk` (v1.30.0) for the MCP server, `zod` (v4) for its tool input schemas (`init.md` §14)

## Frontend

Currently not used — `project-rag` has no UI layer; it is a CLI + MCP server consumed by coding agents (Claude Code, OpenCode, Codex).

## Database

- Qdrant — vector database, used purely as a rebuildable search index (Git remains source of truth) (`init.md` §1, §6); `@qdrant/js-client-rest` (v1.19.0) client

## Embedding

- Pluggable `EmbeddingProvider` interface (`init.md` §7), native `fetch` (no HTTP client dependency), concurrency-capped (5) with a 30s timeout
- Two providers: Ollama (local, e.g. `bge-m3`, the default) or an OpenAI-compatible embedding API

## DevOps

- Docker Compose (`docker-compose.yml`) for Qdrant infra (`init.md` §20)
- The `project-rag` application itself runs locally via Node.js (not containerized), so it can read Git repositories on the host filesystem
- Testing: Vitest 2.1 (`init.md` §3, §23) — 109 tests across all six phases as of this writing
