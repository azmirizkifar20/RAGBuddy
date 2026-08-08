# Build Project RAG — Multi-Project RAG + MCP Server for Coding Agents

## Role

You are a senior backend engineer and AI infrastructure engineer.

Build a production-oriented but initially simple **Project RAG service** called `project-rag`.

The primary purpose of this service is to provide project documentation knowledge to coding agents such as:

* Claude Code
* OpenCode
* Codex

The service must support multiple repositories/projects from a single installation.

The first implementation should prioritize correctness, simplicity, maintainability, and clear architecture over excessive features.

---

# 1. Core Concept

The repository being indexed remains the **source of truth**.

Example:

```text
projects/
├── project-a/
│   ├── CLAUDE.md
│   ├── AGENTS.md
│   ├── docs/
│   │   ├── features/
│   │   ├── steering/
│   │   └── issue/
│   └── src/
│
├── project-b/
│   ├── CLAUDE.md
│   ├── AGENTS.md
│   ├── docs/
│   └── src/
```

`project-rag` must index selected documentation from these repositories into Qdrant.

Do NOT treat Qdrant as the source of truth.

Qdrant is only an index/search layer.

If Qdrant is deleted, the complete index must be rebuildable from the Git repositories.

---

# 2. Important Scope Decision

For the first version, index documentation rather than the entire source code.

Default indexed paths:

```text
docs/
```

Potential future indexed sources:

```text
README.md
docs/
*.md
*.mdx
architecture documents
ADR
business rules
issue/RCA documents
API documentation
OpenAPI documents
```

Do NOT automatically index:

```text
.git/
node_modules/
vendor/
dist/
build/
coverage/
.env
secrets
binary files
large generated files
```

Do not index:

```text
CLAUDE.md
AGENTS.md
.claude/
.agents/
```

unless explicitly configured.

These are agent instructions and should remain directly accessible to the coding agent rather than being treated as ordinary RAG knowledge.

---

# 3. Technology Stack

Use:

* Node.js
* TypeScript
* npm
* Qdrant
* MCP SDK for the MCP server
* Docker Compose for infrastructure
* Vitest or another lightweight TypeScript testing framework

Prefer a simple architecture.

Do not introduce LangChain, LlamaIndex, Flowise, LangFlow, or another large orchestration framework unless there is a concrete technical reason.

The first version should be understandable from the source code itself.

---

# 4. Repository Structure

Create a clean structure similar to:

```text
project-rag/
├── src/
│   ├── config/
│   │   └── config.ts
│   │
│   ├── projects/
│   │   ├── project-registry.ts
│   │   └── project-types.ts
│   │
│   ├── ingestion/
│   │   ├── scanner.ts
│   │   ├── parser.ts
│   │   ├── chunker.ts
│   │   ├── hasher.ts
│   │   └── indexer.ts
│   │
│   ├── embedding/
│   │   ├── embedding-provider.ts
│   │   └── ...
│   │
│   ├── qdrant/
│   │   ├── qdrant-client.ts
│   │   └── qdrant-repository.ts
│   │
│   ├── retrieval/
│   │   └── search.ts
│   │
│   ├── git/
│   │   ├── git-status.ts
│   │   └── git-diff.ts
│   │
│   ├── mcp/
│   │   ├── server.ts
│   │   └── tools/
│   │       ├── search-project-docs.ts
│   │       ├── get-project-document.ts
│   │       └── list-project-knowledge.ts
│   │
│   └── cli/
│       └── ...
│
├── tests/
│
├── scripts/
│
├── docs/
│   ├── architecture.md
│   ├── setup.md
│   ├── ingestion.md
│   ├── retrieval.md
│   └── mcp.md
│
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
├── CLAUDE.md
└── AGENTS.md
```

You may adjust the structure if there is a better design, but keep the separation between:

* ingestion
* embedding
* storage
* retrieval
* Git integration
* MCP
* project management

---

# 5. Multi-Project Support

The service must support multiple projects.

Create a project registry.

Example configuration:

```yaml
projects:
  - id: bidubadu
    name: Bidubadu
    repository: /home/azmirf/projects/bidubadu
    paths:
      - docs

  - id: rhapsodie
    name: Rhapsodie
    repository: /home/azmirf/projects/rhapsodie
    paths:
      - docs
```

The exact registry format can be JSON/YAML or another simple format.

Choose the simplest maintainable implementation.

Each indexed document MUST contain metadata similar to:

```json
{
  "project": "bidubadu",
  "file": "docs/steering/architecture.md",
  "absolute_path": "/home/azmirf/projects/bidubadu/docs/steering/architecture.md",
  "document_type": "markdown",
  "category": "steering",
  "content_hash": "...",
  "git_commit": "...",
  "chunk_index": 0
}
```

Do not expose sensitive absolute filesystem paths through MCP responses unless necessary.

---

# 6. Qdrant Design

Use Qdrant as the vector database.

Start with a simple collection strategy.

Preferred initial strategy:

```text
project_rag_documents
```

with project isolation using payload metadata:

```text
project = bidubadu
```

Searches MUST filter by project.

Example:

```text
project == "bidubadu"
```

Never allow a search for project A to accidentally return documents from project B.

Design the Qdrant layer so that changing to per-project collections later is possible without rewriting the retrieval layer.

---

# 7. Embedding Provider Abstraction

Do not hard-code the application to one embedding vendor.

Create an interface such as:

```ts
interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}
```

The first provider should be configurable.

Support at least one provider initially.

Recommended initial options:

1. OpenAI-compatible embedding API
2. Ollama embedding API

Use environment configuration.

Example:

```env
EMBEDDING_PROVIDER=ollama
EMBEDDING_MODEL=bge-m3
```

or:

```env
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
```

Do not assume the user wants to send documentation to a cloud provider.

The architecture must allow local embedding.

---

# 8. Markdown Parsing

The first version should optimize for Markdown documentation.

Support:

```text
.md
.mdx
.txt
```

Structure-aware chunking is preferred.

Do NOT simply split every N characters.

For Markdown:

```markdown
# Architecture

## Authentication

...

## Database

...

## API

...
```

Preserve heading context in each chunk.

A chunk should retain enough context to understand where it came from.

Example conceptual metadata:

```json
{
  "title": "Architecture",
  "section": "Authentication",
  "file": "docs/steering/architecture.md"
}
```

Use configurable chunk size and overlap.

Reasonable defaults:

```text
chunk size: 800-1200 tokens
overlap: 100-200 tokens
```

If token-based chunking adds unnecessary complexity for the first implementation, use a well-documented character/word approximation and make the implementation replaceable.

---

# 9. Content Hashing

Every indexed document/chunk must be associated with a content hash.

Use a strong hash such as SHA-256.

The purpose is to support incremental indexing.

For example:

```text
architecture.md
    ↓
SHA-256
    ↓
abc123...
```

If the hash has not changed:

```text
DO NOTHING
```

If the hash changed:

```text
DELETE OLD CHUNKS
CREATE NEW CHUNKS
GENERATE EMBEDDINGS
UPSERT TO QDRANT
```

If a file was deleted:

```text
DELETE ITS VECTORS
```

---

# 10. Incremental Sync

Implement:

```bash
project-rag sync <project>
```

The sync operation must:

1. Validate the project.
2. Validate that the repository exists.
3. Validate that it is a Git repository.
4. Scan configured documentation paths.
5. Detect added files.
6. Detect modified files.
7. Detect deleted files.
8. Compare content hashes.
9. Delete obsolete vectors.
10. Chunk new/modified documents.
11. Generate embeddings.
12. Upsert vectors to Qdrant.
13. Store current Git commit metadata.
14. Print a useful summary.

Example output:

```text
Project: bidubadu

Added:
  docs/features/04-voucher.md

Modified:
  docs/steering/architecture.md

Deleted:
  docs/issue/old-login.md

Skipped:
  docs/README.md

Summary:
  Added: 1
  Modified: 1
  Deleted: 1
  Unchanged: 8
```

Do not re-embed unchanged documents.

---

# 11. Initial Full Index

Implement:

```bash
project-rag ingest <project>
```

This performs a full rebuild for that project.

Expected behavior:

```text
project-rag ingest bidubadu
```

should:

1. Read all configured documents.
2. Remove existing vectors for that project.
3. Rebuild the complete project index.
4. Print progress and summary.

This command is important because the complete Qdrant index must always be rebuildable from Git.

---

# 12. Git Commit Auto Sync

Implement automatic sync after a Git commit.

The preferred initial mechanism is a repository-local Git hook.

For example:

```text
project/
└── .git/
    └── hooks/
        └── post-commit
```

After:

```bash
git commit
```

the hook should trigger:

```bash
project-rag sync <project>
```

IMPORTANT:

The hook must not break or block the user's Git workflow if the RAG service is unavailable.

The Git commit should remain successful even if:

* Qdrant is down
* embedding provider is unavailable
* project-rag is unavailable

Therefore the hook should handle failures gracefully and print a warning.

Example:

```text
[project-rag] Sync started...
[project-rag] Warning: RAG sync failed: Qdrant unavailable
[project-rag] Git commit remains successful.
```

Avoid recursive Git operations.

The sync process itself must never create another commit.

---

# 13. Git Hook Installation

Provide:

```bash
project-rag hook install <project>
```

and:

```bash
project-rag hook uninstall <project>
```

The installer should:

1. Validate the Git repository.
2. Create/update the appropriate hook.
3. Preserve an existing hook rather than blindly overwriting it.
4. Clearly document how the hook works.

If an existing `post-commit` hook exists, safely chain the Project RAG command.

Do not destroy an existing user hook.

---

# 14. MCP Server

Implement an MCP server in this repository.

The MCP server is the interface used by:

* Claude Code
* OpenCode
* potentially Codex or other MCP-compatible agents

The MCP server should expose a minimal initial toolset.

### Tool 1: `search_project_docs`

Parameters:

```json
{
  "query": "authentication flow"
}
```

The server should determine the current project where possible.

Also support explicit project identification if needed:

```json
{
  "project": "bidubadu",
  "query": "authentication flow"
}
```

Return concise but useful results containing:

```text
file
section
relevance score
content
```

Do not return huge amounts of context.

---

### Tool 2: `get_project_document`

Parameters:

```json
{
  "file": "docs/steering/architecture.md"
}
```

Return the document content or a relevant section.

The implementation must prevent path traversal.

Do NOT allow:

```text
../../etc/passwd
```

or access outside the registered repository.

---

### Tool 3: `list_project_knowledge`

Return indexed documentation for the current project.

Example:

```text
docs/features/01-authentication.md
docs/features/02-user-management.md
docs/steering/architecture.md
docs/steering/system-flow.md
docs/issue/2026-08-05_login-failure.md
```

This helps agents understand what knowledge is available.

---

# 15. MCP Project Detection

Because Claude Code/OpenCode will normally run from inside a project repository, attempt to determine the current project from the working directory.

For example:

```text
/home/azmirf/projects/bidubadu
```

should resolve to:

```text
bidubadu
```

based on the registered repository path.

However, always allow an explicit project ID as a fallback.

Do not guess if the current directory belongs to multiple/ambiguous projects.

Return a clear error in that situation.

---

# 16. Retrieval

Implement vector similarity retrieval.

Start with:

```text
topK = 5
```

Make it configurable.

Example:

```env
RAG_TOP_K=5
```

Return metadata with every result.

The retrieval layer must enforce:

```text
project filter
```

before returning results.

Do not rely solely on the LLM to filter projects.

---

# 17. Future-Proof Retrieval Architecture

Design retrieval so that these can be added later without major rewrites:

* hybrid search
* BM25
* reranking
* metadata filters
* multiple embeddings
* per-project collections
* parent-child retrieval
* document versioning

Do NOT implement all of these in version 1 unless needed.

Keep the first version simple.

---

# 18. CLI

Create a CLI with commands similar to:

```bash
project-rag project list

project-rag project register <id> <repository>

project-rag project remove <id>

project-rag ingest <project>

project-rag sync <project>

project-rag search <project> "<query>"

project-rag hook install <project>

project-rag hook uninstall <project>

project-rag mcp
```

The exact CLI framework is your choice.

Prefer a lightweight implementation.

---

# 19. Configuration

Provide:

```text
.env.example
```

with all required configuration.

Include:

```env
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=project_rag_documents

EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=bge-m3

RAG_TOP_K=5

PROJECT_REGISTRY_PATH=./config/projects.yaml
```

If OpenAI-compatible embedding is supported:

```env
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=
```

Never commit credentials.

---

# 20. Docker Compose

Create a Docker Compose setup for infrastructure.

At minimum:

```text
Qdrant
```

The Project RAG application itself may initially run locally with Node.js because the Git repositories are on the host filesystem.

Do NOT containerize the application in a way that prevents it from accessing registered repositories.

Document the tradeoff.

A later production deployment may mount project directories into the container.

---

# 21. Security Requirements

Implement basic security from the beginning.

Requirements:

1. Only registered repositories may be indexed.
2. Only configured documentation paths may be indexed.
3. Prevent path traversal.
4. Do not index `.env`.
5. Do not index credentials or obvious secret files.
6. MCP document retrieval must stay inside registered repositories.
7. Project A must never retrieve Project B's documents.
8. Do not expose API keys in logs.
9. Do not expose unnecessary absolute paths through MCP.
10. Validate all MCP tool parameters.

---

# 22. Logging

Use structured and readable logs.

Example:

```text
[INFO] Project bidubadu sync started
[INFO] Scanned 24 files
[INFO] Added 2 files
[INFO] Modified 1 file
[INFO] Deleted 1 file
[INFO] Embedded 34 chunks
[INFO] Qdrant upsert completed
[INFO] Sync completed in 2.4s
```

Errors must contain enough context to debug problems.

---

# 23. Testing

Write tests for at least:

### Project registry

* register project
* find project
* invalid repository
* duplicate project

### Scanner

* find Markdown files
* ignore excluded directories
* ignore `.env`
* ignore unsupported files

### Hashing

* unchanged file produces same hash
* modified file produces different hash

### Chunking

* Markdown headings are preserved
* chunks respect configured limits
* overlap works

### Sync

* new file indexed
* unchanged file skipped
* modified file re-indexed
* deleted file removed

### Security

* path traversal rejected
* unregistered project rejected
* cross-project access rejected

### MCP

* search tool works
* get document works
* invalid file path rejected
* project isolation works

Use mocked Qdrant and embedding providers where practical.

Do not require a real embedding provider for unit tests.

---

# 24. Documentation

Create clear documentation.

At minimum:

```text
docs/
├── architecture.md
├── setup.md
├── ingestion.md
├── retrieval.md
└── mcp.md
```

The README should explain:

1. What Project RAG is.
2. Why it exists.
3. Architecture.
4. Installation.
5. Qdrant setup.
6. Embedding configuration.
7. Project registration.
8. Initial ingestion.
9. Incremental sync.
10. Git hook setup.
11. MCP setup for Claude Code.
12. MCP setup for OpenCode.
13. Troubleshooting.
14. How to rebuild Qdrant from Git.

---

# 25. Agent-Friendly Repository

Because this project itself will be developed using Claude Code and OpenCode, create:

```text
CLAUDE.md
AGENTS.md
```

They should contain:

* project purpose
* architecture overview
* important commands
* coding conventions
* testing instructions
* rules around modifying the ingestion pipeline
* rules around MCP tools
* security requirements
* Qdrant conventions

Keep `CLAUDE.md` and `AGENTS.md` aligned.

---

# 26. Development Phases

Implement the project in phases.

## Phase 1 — Foundation

Build:

* TypeScript project
* configuration
* project registry
* Qdrant client
* embedding provider abstraction
* Markdown scanner
* chunker
* content hashing

Make tests pass.

---

## Phase 2 — Full Ingestion

Implement:

```bash
project-rag ingest <project>
```

Verify:

```text
Git repository
    ↓
docs/
    ↓
chunks
    ↓
embeddings
    ↓
Qdrant
```

---

## Phase 3 — Incremental Sync

Implement:

```bash
project-rag sync <project>
```

Support:

* added
* modified
* deleted
* unchanged files

Use content hashes.

---

## Phase 4 — Retrieval

Implement:

```bash
project-rag search <project> "<query>"
```

Verify that semantic search returns relevant documentation.

---

## Phase 5 — MCP

Implement:

```bash
project-rag mcp
```

Add:

```text
search_project_docs
get_project_document
list_project_knowledge
```

Test with an MCP client.

---

## Phase 6 — Git Hook

Implement:

```bash
project-rag hook install <project>
```

Verify:

```text
edit docs
    ↓
git add
    ↓
git commit
    ↓
post-commit
    ↓
project-rag sync
    ↓
Qdrant updated
```

The commit must remain successful even when RAG sync fails.

---

# 27. Important Non-Goals for Version 1

Do NOT initially implement:

* web UI
* Flowise integration
* LangChain
* LangGraph
* multi-agent orchestration
* reranking
* hybrid search
* source-code semantic indexing
* automatic web crawling
* authentication system
* multi-user SaaS
* complex distributed architecture

These can be added later.

The goal of V1 is:

```text
Git Repository
       ↓
docs/
       ↓
Project RAG
       ↓
Qdrant
       ↓
MCP
       ↓
Claude Code / OpenCode
```

---

# 28. Expected Final Workflow

After the project is complete, I want this workflow to work:

### Initial setup

```bash
project-rag project register bidubadu /home/azmirf/projects/bidubadu

project-rag ingest bidubadu

project-rag hook install bidubadu
```

### Daily development

I edit:

```text
docs/steering/architecture.md
```

Then:

```bash
git add .
git commit -m "update architecture docs"
```

The Git hook automatically executes:

```text
project-rag sync bidubadu
```

Only changed documentation is re-indexed.

### Claude Code

Claude Code should be able to use the MCP server:

```text
project-rag
```

and call:

```text
search_project_docs
get_project_document
list_project_knowledge
```

### OpenCode

OpenCode should be able to use the exact same MCP server.

There must NOT be separate RAG implementations for Claude Code and OpenCode.

---

# 29. Development Instructions

Before writing substantial code:

1. Inspect the environment.
2. Check available Node.js/npm versions.
3. Check whether Docker is available.
4. Check whether Qdrant is already running.
5. Inspect the repository.
6. Create a concise implementation plan.
7. Implement incrementally.
8. Run tests after each major phase.
9. Keep documentation updated with architecture decisions.

Do not ask me to manually create files that you can create yourself.

Do not leave TODO placeholders for core functionality.

If a technical choice is ambiguous, choose the simplest production-sensible option and document the decision.

At the end of each major phase, provide:

```text
Implemented:
Tests:
Commands:
Remaining:
```

---

# 30. Definition of Done

Version 1 is complete when all of the following work:

```text
[✓] Node.js/TypeScript project
[✓] Qdrant running through Docker Compose
[✓] Project registry
[✓] Markdown documentation scanner
[✓] Structure-aware chunking
[✓] Content hashing
[✓] Embedding abstraction
[✓] Qdrant indexing
[✓] Full ingestion
[✓] Incremental sync
[✓] Deleted-file cleanup
[✓] Multi-project isolation
[✓] CLI
[✓] Git post-commit hook
[✓] MCP server
[✓] search_project_docs
[✓] get_project_document
[✓] list_project_knowledge
[✓] Claude Code MCP configuration documentation
[✓] OpenCode MCP configuration documentation
[✓] Unit tests
[✓] Security/path traversal tests
[✓] Architecture documentation
[✓] Setup documentation
[✓] Rebuild-from-Git workflow documented
```

Start by inspecting the current environment and repository, then propose the Phase 1 implementation plan before making major changes.
