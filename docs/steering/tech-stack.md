# Technology Stack

## Overview

Stack decisions per [`../../init.md`](../../init.md) §3, as actually installed (see `package.json`).

## Backend

- Node.js 24 + TypeScript 5.6 (CommonJS output — chosen over ESM to avoid `.js`-extension import friction; `tsconfig.json` for typecheck, `tsconfig.build.json` for the `dist/` build)
- npm (package manager)
- CLI: hand-rolled argv parsing (`src/cli/args.ts`) — no framework dependency for six commands
- `@modelcontextprotocol/sdk` (v1.30.0) for the MCP server, `zod` (v4) for its tool input schemas (`init.md` §14)

## Frontend

`web/` — a separate Vite project (own `package.json`/toolchain, kept out of the backend's `tsconfig.build.json`): React 19 + TypeScript ~6.0, Tailwind CSS v4 (`@tailwindcss/vite` plugin), shadcn/ui (Radix base, Nova preset) for buttons/cards/dialogs/badges/toasts, `react-router` v8 for the Dashboard/Project Detail routes. `npm run build` produces `web/dist`, served as static files by `ragbuddy web` (`src/server/app.ts`) alongside its REST API — one process, one port. This is in addition to, not a replacement for, the CLI + MCP server, which remain the primary interface for coding agents.

## Desktop Shell

`electron/` — a third, equally separate Node project (own `package.json`, no npm workspace link to the root or to `web/`) wrapping the same backend + `web/dist` in a native window via Electron. Contains no application logic: `main.js` spawns `dist/cli/index.js web` (same binary `ragbuddy web` runs) and loads its dashboard in a `BrowserWindow` — see [11-electron-desktop-app.md](../features/11-electron-desktop-app.md).

## Database

- Qdrant — vector database, used purely as a rebuildable search index (Git remains source of truth) (`init.md` §1, §6); `@qdrant/js-client-rest` (v1.19.0) client

## Embedding

- Pluggable `EmbeddingProvider` interface (`init.md` §7), native `fetch` (no HTTP client dependency), concurrency-capped (5) with a 30s timeout
- Two providers: Ollama (local, e.g. `bge-m3`, the default) or an OpenAI-compatible embedding API

## DevOps

- Docker Compose (`docker-compose.yml`) for Qdrant infra (`init.md` §20)
- The `ragbuddy` application itself runs locally via Node.js (not containerized), so it can read Git repositories on the host filesystem
- Testing: Vitest 2.1 (`init.md` §3, §23) — 109 tests across all six phases as of this writing
