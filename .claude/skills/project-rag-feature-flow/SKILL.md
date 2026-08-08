---
name: project-rag-feature-flow
description: Workflow for implementing, changing, extending, or refactoring features in project-rag. Covers current-state (and planned) documentation, runtime-path tracing, tests, verification, and documentation updates.
---

# project-rag Feature Flow

Follow this flow for feature work in this repository.

## 0. Project status

`project-rag` is currently pre-implementation — only [`init.md`](../../../init.md) (the full build spec) and the `docs/` scaffold exist. Every doc in `docs/features/` is marked **Planned**. When you implement a phase from `init.md` §26, flip that feature doc's status from Planned to Implemented and fill in its real file paths (see step 5).

## 1. Read the current-state docs first

- Start by checking [docs/features/README.md](../../../docs/features/README.md).
- Find the most relevant existing (or planned) doc with repo terms before coding.
- Also check [docs/steering/](../../../docs/steering/) for architecture, routing (CLI/MCP), tech-stack, and system-flow context.
- Cross-check against [init.md](../../../init.md) itself — it is the authoritative spec until the docs are updated to reflect real implementation.

## 2. Trace the real runtime path

- Prove the implementation path from the repo, not from assumptions. Once code exists, trace actual imports/calls rather than trusting a planned-doc path.

## 3. Add or update tests when they materially protect the change

- Treat test evaluation as part of the implementation, not optional follow-up.
- Priority order per `init.md` §23: project registry, scanner, hashing, chunking, sync (add/modify/delete/unchanged), security (path traversal, cross-project isolation), MCP tools.
- Mock Qdrant and the embedding provider in unit tests — do not require a real embedding provider or live Qdrant instance (`init.md` §23).
- Do not force tests for every low-risk edit (copy tweaks, trivial wiring). When you choose not to add tests, state the reason in the completion summary.

## 4. Verify the changed path

- Test runner: Vitest (per spec — `init.md` §3). Exact command TBD once `package.json` is created; expected `npm test` / `npx vitest run`.
- If no test was added because the change was low-value to cover, verify the path with another focused check matching the risk (manual CLI run, targeted command).

## 5. Update or create docs after implementation

Docs are part of feature work, not optional follow-up. Never leave implementation reflected only in code.

**When creating a NEW feature or a feature not covered by an existing doc:**
1. Create a new numbered feature doc in `docs/features/...md` (sequential numbering, e.g. if highest is `06-...md`, new doc is `07-...md`)
2. Follow the same structure as existing feature docs (flow, routes, domain, UI, data shape)
3. Add an entry + link to that new doc in `docs/features/README.md` index

**When IMPLEMENTING a Planned feature or REVISING an existing one:**
1. Update the existing feature doc in `docs/features/` that covers it — flip `**Status: Planned**` to `**Status: Implemented**` once code lands, and replace planned file references with real paths
2. REPLACE the `**Recent**:` line in `docs/features/README.md` with ONLY the latest change (never append to it); set `**Updated**:` to today's date

**When a bug / root cause is investigated or fixed:**
1. Create `docs/issue/YYYY-MM-DD_nama-issue.md`
2. If it changes feature behavior, update the matching `docs/features/` doc too

## Repo conventions

Not yet established — this is a pre-implementation repo (no `package.json`, no source files). Once code exists, capture here: module system (CommonJS vs ESM), TypeScript strictness, naming/file structure, and the `EmbeddingProvider`/Qdrant-repository interfaces described in [docs/steering/architecture.md](../../../docs/steering/architecture.md). Until then, follow the layer boundaries and file layout in `init.md` §4 and `docs/steering/architecture.md`.

## Security rules (non-negotiable, `init.md` §21)

- Only registered repositories/paths may be indexed or read
- Every MCP/CLI path must be validated against path traversal
- Project A must never see Project B's documents — enforce the `project` filter at the retrieval/storage layer, never rely on the LLM
- Never index `.env`, credentials, or secret-looking files
- Never log API keys or expose unnecessary absolute paths through MCP

<!-- feature-flow-creator v2.4.4 -->
