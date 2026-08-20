# Feature Documentation

This folder contains documentation for implemented features and current state.

**Updated**: 2026-08-20
**Recent**: Settings page gained an "API access" section to generate/rotate/remove the shared API key (backed by `ApiKeyStore`/`config/api-key.json`, no restart needed) instead of only via `RAGBUDDY_API_KEY` env var; the dashboard itself stores the key client-side and attaches it automatically once one exists. Also, `ragbuddy project register`/the Add Project modal now require at least one `paths` entry — no more silent default to `docs/` (`ProjectRegistry.register` throws `At least one path to index is required` otherwise). See [01-project-registry-and-multi-project-support.md](./01-project-registry-and-multi-project-support.md) and [12-external-web-app-integration.md](./12-external-web-app-integration.md#4-hardening-for-external-callers-optional).

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

---

**Catatan**: Tambahkan dokumen baru untuk fitur baru dengan nomor urut berurutan (misal terakhir `06-...md`, berikutnya `07-...md`). Perbarui dokumen yang ada saat fitur diimplementasikan (ubah status dari "Planned" ke "Implemented" dan isi bagian Related Files dengan path nyata), dan selalu catat tanggal update di bagian atas README ini.
