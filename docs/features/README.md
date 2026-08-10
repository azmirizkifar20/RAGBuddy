# Feature Documentation

This folder contains documentation for implemented features and current state.

**Updated**: 2026-08-10
**Recent**: Fixed a regression where `ragbuddy ingest` 404'd on the very first file right after `qdrant drop-collection` — the per-file delete now checks once whether the collection exists at all before attempting any delete — see [02-ingestion-full-index.md](./02-ingestion-full-index.md).

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

---

**Catatan**: Tambahkan dokumen baru untuk fitur baru dengan nomor urut berurutan (misal terakhir `06-...md`, berikutnya `07-...md`). Perbarui dokumen yang ada saat fitur diimplementasikan (ubah status dari "Planned" ke "Implemented" dan isi bagian Related Files dengan path nyata), dan selalu catat tanggal update di bagian atas README ini.
