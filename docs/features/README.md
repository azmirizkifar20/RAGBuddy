# Feature Documentation

This folder contains documentation for implemented features and current state.

**Updated**: 2026-08-13
**Recent**: Added chat answer feedback (👍/👎 buttons, logged server-side to `ChatFeedbackStore` — see [09-project-chat.md](./09-project-chat.md#answer-feedback-2026-08-13)) and doc staleness detection (`GET /api/projects/:id/knowledge` flags a document once the repo has moved `STALE_COMMIT_THRESHOLD` commits past its indexed commit, surfaced as a warning badge in the Documents tab — see [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md#doc-staleness-detection-2026-08-13)).

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

---

**Catatan**: Tambahkan dokumen baru untuk fitur baru dengan nomor urut berurutan (misal terakhir `06-...md`, berikutnya `07-...md`). Perbarui dokumen yang ada saat fitur diimplementasikan (ubah status dari "Planned" ke "Implemented" dan isi bagian Related Files dengan path nyata), dan selalu catat tanggal update di bagian atas README ini.
