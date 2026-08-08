# Technology Stack

## Overview

Stack decisions per [`../../init.md`](../../init.md) §3. Nothing is installed yet — this documents the *chosen* stack, to be scaffolded in Phase 1.

## Backend

- Node.js + TypeScript
- npm (package manager, no yarn/pnpm specified)
- CLI framework: unspecified/lightweight, chosen at implementation time (`init.md` §18)
- MCP SDK for the MCP server (`init.md` §14)

## Frontend

Currently not used — `project-rag` has no UI layer; it is a CLI + MCP server consumed by coding agents (Claude Code, OpenCode, Codex).

## Database

- Qdrant — vector database, used purely as a rebuildable search index (Git remains source of truth) (`init.md` §1, §6)

## Embedding

- Pluggable `EmbeddingProvider` interface (`init.md` §7)
- Initial providers: Ollama (local, e.g. `bge-m3`) or an OpenAI-compatible embedding API

## DevOps

- Docker Compose for Qdrant infra (`init.md` §20)
- The `project-rag` application itself runs locally via Node.js (not containerized), so it can read Git repositories on the host filesystem
- Testing: Vitest (or another lightweight TS test framework) (`init.md` §3, §23)
