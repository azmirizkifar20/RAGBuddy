# Full Ingestion

**Status: Implemented** (Phase 2 — Full Ingestion). Traced from [`../../init.md`](../../init.md) §8–§11, §26.

## 1) What This Feature Is

The full-rebuild pipeline: scan a project's configured doc paths, chunk the Markdown structure-aware, hash content, embed, and upsert everything into Qdrant. This is what makes the Qdrant index fully rebuildable from Git at any time.

**Full rebuild only, not incremental:** `ragbuddy ingest <project>` always re-scans, re-chunks, and re-upserts the complete document set for a project — it does not skip unchanged files or diff against the existing index. Hash-based skip/incremental sync (comparing `content_hash` to avoid re-embedding unchanged chunks) is still Phase 3 and not yet implemented; a reader should not assume `ingest` is incremental.

- Spec: [`../../init.md`](../../init.md) §8 (Markdown Parsing), §9 (Content Hashing), §11 (Initial Full Index)
- Implemented (Phase 1 building blocks): `src/ingestion/{scanner,hasher,parser,chunker}.ts`
- Implemented (Phase 2 orchestration): `src/ingestion/indexer.ts`, `src/git/git-status.ts`, `src/qdrant/qdrant-repository.ts`, `src/cli/{args,ingest-command,index}.ts`
- Planned (Phase 3): hash-based skip/incremental sync

## 2) Flow / Behavior

`ragbuddy ingest <project>`:
1. Read all configured documents (default `docs/`, per project config)
2. For each file, in turn: remove that file's existing vectors, chunk + hash + embed it, then upsert its new points immediately — not accumulated and written once at the end (see the non-atomic-swap note below)
3. Remove vectors for any previously-indexed file no longer present in the current scan
4. Print progress and a summary

A file that fails to embed stops the run with an error, but every file that already finished this run stays indexed — re-running `ragbuddy sync <project>` afterward only (re)processes what didn't finish, since `sync` skips any file whose `content_hash` already matches what's in Qdrant.

## 3) Domain & Data

- **The repository root's README is always indexed**, even when it falls outside every configured path — a project registered with `paths: ["docs"]` still gets its top-level `README.md` (or `Readme.MD`/`README.txt`, matched case-insensitively; `.md` preferred if more than one exists). This is a fixed rule, not per-project configuration: requiring `paths` to include `.` just to reach the README would also pull in every stray Markdown file scattered at the repo root. A README nested in a subdirectory (`packages/sub/README.md`) is not covered by this rule — it still needs to be inside a configured path. Implemented once in `scanDocuments` (`src/ingestion/scanner.ts`) so `ingest`, `sync`, and `get_project_document` all agree on it automatically.
- Scanner respects the exclude list: `.git/`, `node_modules/`, `vendor/`, `dist/`, `build/`, `coverage/`, `.env`, secrets, binaries, large generated files, and (unless explicitly configured) `CLAUDE.md`/`AGENTS.md`/`.claude/`/`.agents/` (`init.md` §2)
- Supported file types: `.md`, `.mdx`, `.txt` (`init.md` §8)
- Chunking preserves heading context (title/section) — not naive N-character splitting; default chunk size 800–1200 tokens, overlap 100–200 tokens, configurable (`init.md` §8)
- Every chunk carries metadata: `project`, `file`, `absolute_path`, `document_type`, `category`, `content_hash`, `git_commit`, `chunk_index` (`init.md` §5)
- Hashing: SHA-256 per file/chunk (`init.md` §9)

## 4) UI

Not applicable — CLI only.

## 5) Edge Cases & Rules

- Unsupported/binary files are skipped, not errored
- `absolute_path` must not leak through MCP responses unnecessarily (`init.md` §5, §21.9)
- **Per-file durability (fixed 2026-08-10):** `indexProject` used to accumulate every file's points in memory and do one delete-everything-then-upsert-everything at the very end — a failure on the last file (or the final Qdrant write itself) lost the whole run, including files that had already embedded successfully, however long that took. It now deletes-then-upserts one file at a time (same pattern as `sync.ts`), so a mid-run failure only leaves the file being processed unfinished; everything before it stays indexed. Still not a full atomic guarantee for that one in-flight file (two separate network calls, delete then upsert) — a true per-run guarantee would need points tagged with a version/run id, per the document-versioning future feature in `init.md` §17. Checks once up front (not per file) whether the collection exists at all and skips the per-file delete entirely when it doesn't (e.g. right after `qdrant drop-collection`, before anything's been re-ingested) — deleting from a missing collection 404s, which briefly regressed this exact scenario. See [../issue/2026-08-10_ingest-loses-progress-on-dimension-mismatch.md](../issue/2026-08-10_ingest-loses-progress-on-dimension-mismatch.md) and [../issue/2026-08-10_ingest-fails-on-dropped-collection.md](../issue/2026-08-10_ingest-fails-on-dropped-collection.md).
- **Embedding-dimension guard (fixed 2026-08-10):** `ensureCollection` (`src/qdrant/qdrant-client.ts`) now checks an *existing* collection's configured vector size against the current embedding model's output size and throws a clear, actionable error immediately if they don't match — instead of every file embedding first (potentially a long, slow run) and only then hitting a raw Qdrant "Bad Request" on the final write. Recreating the Qdrant collection at a new dimension still requires re-ingesting every project sharing it — this guard only makes the failure fast and legible, it doesn't migrate data. "Current embedding model" now means whichever (credential, model) pair is active in **Settings → Embedding credentials** (see [10-chat-provider-settings.md](./10-chat-provider-settings.md)), not just whatever `EMBEDDING_MODEL` is in `.env` — the Settings UI warns before activating a different model for exactly this reason.
- **Recreating the collection at a new dimension:** `ragbuddy qdrant drop-collection [--yes]` (`src/cli/qdrant-command.ts`) deletes the shared Qdrant collection so `ensureCollection` recreates it fresh at whatever dimension the next `ingest`/`sync`/upload uses. Destructive to every registered project at once (the collection is shared, not per-project) — without `--yes` it only previews the affected project ids and exits without dropping anything. Every project must then be re-ingested. The same action is also reachable from the dashboard: **Settings → Danger zone** (`web/src/pages/settings.tsx`'s `QdrantDangerZone`) shows the collection's current vector size/point count and every affected project, and requires typing the collection's exact name into a confirm field before the drop button enables — backed by `GET`/`POST /api/settings/qdrant[/drop-collection]` (`src/server/routes/settings.ts`), the latter requiring `{ confirm: true }` in the body. See [../issue/2026-08-10_ingest-loses-progress-on-dimension-mismatch.md](../issue/2026-08-10_ingest-loses-progress-on-dimension-mismatch.md).
- **Ollama embedding resilience:** `OllamaEmbeddingProvider.embedOne` (`src/embedding/embedding-provider.ts`) splits any input over `OLLAMA_SPLIT_THRESHOLD_CHARS` (800 chars) in half and mean-pools the two halves' embeddings on **any** `500` — this recovers Ollama's batch-size ceiling (`num_batch`, default 2048 tokens; the char-based chunk size estimate in `chunker.ts` can undercount tokens for dense content) without depending on Ollama's error wording, which isn't a stable contract. Inputs at or under the threshold instead retry with exponential backoff (500ms, 1s) up to twice, since a `500` there is a genuinely transient server failure rather than a batch-size problem. `EMBEDDING_CONCURRENCY` (Ollama provider only) is `2`, kept low so a single local Ollama process isn't overloaded by concurrent calls for heavier models (e.g. `bge-m3`). See [../issue/2026-08-10_ollama-embedding-500.md](../issue/2026-08-10_ollama-embedding-500.md).
- **OpenAI-compatible batch limit + rate-limit retry:** `OpenAICompatibleEmbeddingProvider.embedDocuments` chunks `texts` into batches of at most `OPENAI_MAX_BATCH_SIZE` (100) before each `/embeddings` call — a file chunking to more pieces than that (e.g. a large doc split into 200+ chunks) sent as one request 400s against a Gemini-backed proxy, which caps `BatchEmbedContentsRequest` at 100 items. `request()` also retries a `429` (rate limit) or transient `5xx` up to `OPENAI_MAX_RETRIES` (4) times with backoff, honoring a numeric `Retry-After` header when present. A non-429 `4xx` is never retried. See [../issue/2026-08-10_gemini-batch-embed-limit.md](../issue/2026-08-10_gemini-batch-embed-limit.md).

## Related Files

- Spec source: [`../../init.md`](../../init.md) §8, §9, §11
- Phase 2 orchestration: `src/ingestion/indexer.ts`, `src/git/git-status.ts`, `src/qdrant/qdrant-repository.ts`, `src/cli/args.ts`, `src/cli/ingest-command.ts`, `src/cli/index.ts`
- Phase 1 building blocks (used by the pipeline): `src/ingestion/scanner.ts`, `src/ingestion/hasher.ts`, `src/ingestion/parser.ts`, `src/ingestion/chunker.ts`

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [01-project-registry-and-multi-project-support.md](./01-project-registry-and-multi-project-support.md)
