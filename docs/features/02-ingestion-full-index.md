# Full Ingestion

**Status: Planned** (Phase 2 — Full Ingestion). Not yet implemented; traced from [`../../init.md`](../../init.md) §8–§11, §26.

## 1) What This Feature Is

The full-rebuild pipeline: scan a project's configured doc paths, chunk the Markdown structure-aware, hash content, embed, and upsert everything into Qdrant. This is what makes the Qdrant index fully rebuildable from Git at any time.

**Phase 1 scope:** Phase 1 delivered the scanner, hasher, parser, and chunker building blocks (`src/ingestion/{scanner,hasher,parser,chunker}.ts`); the full `project-rag ingest` orchestration (`src/ingestion/indexer.ts`) is still Phase 2.

- Spec: [`../../init.md`](../../init.md) §8 (Markdown Parsing), §9 (Content Hashing), §11 (Initial Full Index)
- Implemented (Phase 1): `src/ingestion/{scanner,hasher,parser,chunker}.ts`
- Planned (Phase 2): `src/ingestion/indexer.ts`

## 2) Flow / Behavior

`project-rag ingest <project>`:
1. Read all configured documents (default `docs/`, per project config)
2. Remove existing vectors for that project in Qdrant
3. Chunk + hash + embed + upsert the complete set
4. Print progress and a summary

## 3) Domain & Data

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

## Related Files

- Spec source: [`../../init.md`](../../init.md) §8, §9, §11

## Cross-References

- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- Depends on: [01-project-registry-and-multi-project-support.md](./01-project-registry-and-multi-project-support.md)
