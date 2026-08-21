# Feature Documentation

This folder contains documentation for implemented features and current state.

**Updated**: 2026-08-21
**Recent**: Production URL layout reworked: `ragbuddy web` now serves the landing page at `/`, the login screen moved to its own URL `/login` (standalone mount + redirects; logout returns there), and the whole SPA lives under `/dashboard/*` (router `basename="/dashboard"` — no internal links changed). Old pre-landing URLs redirect to `/dashboard/<tail>`, Electron loads `/dashboard`, the Vite dev server mirrors prod via a `serve-landing` plugin, and the new static-ordering behavior is locked by `tests/server/static-serving.test.ts`.

## Index

1. [Project Registry & Multi-Project Support](./01-project-registry-and-multi-project-support.md) — Implemented
2. [Full Ingestion](./02-ingestion-full-index.md) — Implemented
3. [Incremental Sync](./03-incremental-sync.md) — Implemented
4. [Retrieval / Search](./04-retrieval-search.md) — Implemented
5. [MCP Server](./05-mcp-server.md) — Implemented
6. [Git Hook Auto Sync](./06-git-hook-auto-sync.md) — Implemented
7. [Web Frontend & CLI Project Subcommands](./07-web-frontend-and-project-cli.md) — Implemented
8. [Dashboard Redesign, Document Uploads & Sync History](./08-dashboard-redesign-uploads-and-history.md) — Implemented
9. [Per-Project Chat](./09-project-chat.md) — Implemented
10. [Provider Credentials (Embedding & Chat)](./10-chat-provider-settings.md) — Implemented
11. [Electron Desktop Shell](./11-electron-desktop-app.md) — Implemented (first cut — packaging not yet verified)
12. [External Web App Integration (Chat / RAG API)](./12-external-web-app-integration.md) — Implemented
13. [Dashboard Login Auth (Opt-in Access Code Gate)](./13-dashboard-login-auth.md) — Implemented
14. [Landing Page](./14-landing-page.md) — Implemented

---

**Catatan**: Tambahkan dokumen baru untuk fitur baru dengan nomor urut berurutan (misal terakhir `06-...md`, berikutnya `07-...md`). Perbarui dokumen yang ada saat fitur diimplementasikan (ubah status dari "Planned" ke "Implemented" dan isi bagian Related Files dengan path nyata), dan selalu catat tanggal update di bagian atas README ini.
