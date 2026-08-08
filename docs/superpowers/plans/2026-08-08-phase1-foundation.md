# Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `project-rag` TypeScript project and its Phase 1 building blocks — config, project registry, content hashing, Markdown scanning/parsing/chunking, embedding provider abstraction, and a Qdrant client wrapper — all unit-tested without a live Qdrant or embedding server, per `init.md` §26 Phase 1.

**Architecture:** A CommonJS TypeScript project (Node 24, no ESM extension friction), Vitest for tests, `@qdrant/js-client-rest` for Qdrant, native `fetch` for embedding HTTP calls (no HTTP client dependency), JSON for the project registry file (simplest option explicitly allowed by `init.md` §5 — avoids adding a YAML dependency). Layout follows `init.md` §4 / `docs/steering/architecture.md`.

**Tech Stack:** Node.js 24, TypeScript 5.x, Vitest, `@qdrant/js-client-rest`.

## Global Constraints

- Language/runtime: Node.js + TypeScript, npm as package manager (`init.md` §3).
- Test framework: Vitest (`init.md` §3, §23).
- Do not introduce LangChain, LlamaIndex, Flowise, LangGraph, or another orchestration framework (`init.md` §3, §27).
- Do not require a real embedding provider or live Qdrant for unit tests — mock both (`init.md` §23).
- Never index `.env`, credentials, or obvious secret files; never index `CLAUDE.md`/`AGENTS.md`/`.claude/`/`.agents/` unless explicitly configured (`init.md` §2).
- Project isolation (payload filter `project == "<id>"`) must be enforced at the storage/retrieval layer, never left to the LLM — this Phase lays the Qdrant client groundwork for that (`init.md` §6, §21.7).
- Never commit credentials (`init.md` §19).
- Every generated feature doc for this phase must be flipped from "Planned" to "Implemented" once its code lands (`.claude/skills/project-rag-feature-flow/SKILL.md` step 5).

---

### Task 1: TypeScript Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `config/projects.example.json`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: npm scripts `build`, `typecheck`, `test` that every later task's steps rely on to verify their work

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "project-rag",
  "version": "0.1.0",
  "private": true,
  "description": "Multi-project RAG + MCP server for coding agents",
  "main": "dist/cli/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@qdrant/js-client-rest": "^1.13.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
config/projects.json
```

- [ ] **Step 5: Create `.env.example`**

```env
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=project_rag_documents

EMBEDDING_PROVIDER=ollama
EMBEDDING_BASE_URL=http://localhost:11434
EMBEDDING_MODEL=bge-m3
# EMBEDDING_API_KEY is only required when EMBEDDING_PROVIDER=openai
EMBEDDING_API_KEY=

RAG_TOP_K=5

PROJECT_REGISTRY_PATH=./config/projects.json
```

- [ ] **Step 6: Create `config/projects.example.json`**

```json
{
  "projects": []
}
```

- [ ] **Step 7: Install dependencies and verify the toolchain**

Run: `npm install`
Expected: installs cleanly, creates `package-lock.json` and `node_modules/`.

Run: `npm run typecheck`
Expected: passes with no errors (no `.ts` files exist yet, so this just proves the compiler config is valid — create an empty `src/index.ts` with `export {};` first if `tsc --noEmit` errors on an empty project).

Run: `npm test`
Expected: Vitest runs with "No test files found" (or passes with 0 tests) — proves the test runner is wired up.

- [ ] **Step 8: Commit**

```bash
git init
git add package.json tsconfig.json vitest.config.ts .gitignore .env.example config/projects.example.json
git commit -m "chore: scaffold TypeScript project"
```

---

### Task 2: Config Loader

**Files:**
- Create: `src/config/config.ts`
- Test: `tests/config/config.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `interface AppConfig { qdrantUrl: string; qdrantCollection: string; embeddingProvider: 'ollama' | 'openai'; embeddingBaseUrl: string; embeddingModel: string; embeddingApiKey?: string; ragTopK: number; projectRegistryPath: string }` and `function loadConfig(env?: NodeJS.ProcessEnv): AppConfig` — used by Task 8 (embedding provider factory input) and the future CLI.

- [ ] **Step 1: Write the failing test**

`tests/config/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config/config';

describe('loadConfig', () => {
  it('applies defaults when optional vars are missing', () => {
    const config = loadConfig({
      QDRANT_URL: 'http://localhost:6333',
      EMBEDDING_PROVIDER: 'ollama',
      EMBEDDING_MODEL: 'bge-m3',
    } as NodeJS.ProcessEnv);

    expect(config.qdrantUrl).toBe('http://localhost:6333');
    expect(config.qdrantCollection).toBe('project_rag_documents');
    expect(config.embeddingBaseUrl).toBe('http://localhost:11434');
    expect(config.ragTopK).toBe(5);
    expect(config.projectRegistryPath).toBe('./config/projects.json');
  });

  it('throws when a required var is missing', () => {
    expect(() =>
      loadConfig({ EMBEDDING_PROVIDER: 'ollama', EMBEDDING_MODEL: 'bge-m3' } as NodeJS.ProcessEnv),
    ).toThrow('QDRANT_URL');
  });

  it('throws on an invalid embedding provider', () => {
    expect(() =>
      loadConfig({
        QDRANT_URL: 'http://localhost:6333',
        EMBEDDING_PROVIDER: 'bogus',
        EMBEDDING_MODEL: 'bge-m3',
      } as NodeJS.ProcessEnv),
    ).toThrow('Unknown EMBEDDING_PROVIDER');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/config.test.ts`
Expected: FAIL with "Cannot find module '../../src/config/config'".

- [ ] **Step 3: Write minimal implementation**

`src/config/config.ts`:

```typescript
export interface AppConfig {
  qdrantUrl: string;
  qdrantCollection: string;
  embeddingProvider: 'ollama' | 'openai';
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingApiKey?: string;
  ragTopK: number;
  projectRegistryPath: string;
}

const DEFAULT_EMBEDDING_BASE_URL: Record<string, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const qdrantUrl = requireVar(env, 'QDRANT_URL');
  const embeddingProvider = requireVar(env, 'EMBEDDING_PROVIDER');
  if (embeddingProvider !== 'ollama' && embeddingProvider !== 'openai') {
    throw new Error(`Unknown EMBEDDING_PROVIDER: ${embeddingProvider}`);
  }
  const embeddingModel = requireVar(env, 'EMBEDDING_MODEL');

  return {
    qdrantUrl,
    qdrantCollection: env.QDRANT_COLLECTION ?? 'project_rag_documents',
    embeddingProvider,
    embeddingBaseUrl: env.EMBEDDING_BASE_URL ?? DEFAULT_EMBEDDING_BASE_URL[embeddingProvider],
    embeddingModel,
    embeddingApiKey: env.EMBEDDING_API_KEY,
    ragTopK: env.RAG_TOP_K ? Number(env.RAG_TOP_K) : 5,
    projectRegistryPath: env.PROJECT_REGISTRY_PATH ?? './config/projects.json',
  };
}

function requireVar(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/config.ts tests/config/config.test.ts
git commit -m "feat: add env config loader"
```

---

### Task 3: Project Types & Registry

**Files:**
- Create: `src/projects/project-types.ts`
- Create: `src/projects/project-registry.ts`
- Test: `tests/projects/project-registry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `interface ProjectConfig { id: string; name: string; repository: string; paths: string[] }`, `interface ProjectRegistryData { projects: ProjectConfig[] }`, and `class ProjectRegistry { constructor(registryPath: string); list(): ProjectConfig[]; find(id: string): ProjectConfig | undefined; register(id: string, repository: string, opts?: { name?: string; paths?: string[] }): ProjectConfig; remove(id: string): void }` — used by the future CLI and MCP project-resolution layer.

- [ ] **Step 1: Write the failing test**

`tests/projects/project-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectRegistry } from '../../src/projects/project-registry';

describe('ProjectRegistry', () => {
  let dir: string;
  let registryPath: string;
  let repoPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-registry-'));
    registryPath = path.join(dir, 'projects.json');
    repoPath = path.join(dir, 'sample-repo');
    mkdirSync(path.join(repoPath, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('registers a project and persists it', () => {
    const registry = new ProjectRegistry(registryPath);
    const project = registry.register('sample', repoPath);
    expect(project).toEqual({ id: 'sample', name: 'sample', repository: repoPath, paths: ['docs'] });

    const reloaded = new ProjectRegistry(registryPath);
    expect(reloaded.list()).toEqual([project]);
  });

  it('finds a registered project by id', () => {
    const registry = new ProjectRegistry(registryPath);
    registry.register('sample', repoPath);
    expect(registry.find('sample')?.id).toBe('sample');
    expect(registry.find('missing')).toBeUndefined();
  });

  it('rejects a repository path that does not exist', () => {
    const registry = new ProjectRegistry(registryPath);
    expect(() => registry.register('sample', path.join(dir, 'nope'))).toThrow('does not exist');
  });

  it('rejects a repository that is not a Git repository', () => {
    const nonGitRepo = path.join(dir, 'not-git');
    mkdirSync(nonGitRepo, { recursive: true });
    const registry = new ProjectRegistry(registryPath);
    expect(() => registry.register('sample', nonGitRepo)).toThrow('Not a Git repository');
  });

  it('rejects registering a duplicate project id', () => {
    const registry = new ProjectRegistry(registryPath);
    registry.register('sample', repoPath);
    expect(() => registry.register('sample', repoPath)).toThrow('already registered');
  });

  it('removes a registered project', () => {
    const registry = new ProjectRegistry(registryPath);
    registry.register('sample', repoPath);
    registry.remove('sample');
    expect(registry.find('sample')).toBeUndefined();
    expect(() => registry.remove('sample')).toThrow('is not registered');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/projects/project-registry.test.ts`
Expected: FAIL with "Cannot find module '../../src/projects/project-registry'".

- [ ] **Step 3: Write minimal implementation**

`src/projects/project-types.ts`:

```typescript
export interface ProjectConfig {
  id: string;
  name: string;
  repository: string;
  paths: string[];
}

export interface ProjectRegistryData {
  projects: ProjectConfig[];
}
```

`src/projects/project-registry.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ProjectConfig, ProjectRegistryData } from './project-types';

export class ProjectRegistry {
  constructor(private readonly registryPath: string) {}

  list(): ProjectConfig[] {
    return this.load().projects;
  }

  find(id: string): ProjectConfig | undefined {
    return this.load().projects.find((p) => p.id === id);
  }

  register(
    id: string,
    repository: string,
    opts: { name?: string; paths?: string[] } = {},
  ): ProjectConfig {
    const data = this.load();
    if (data.projects.some((p) => p.id === id)) {
      throw new Error(`Project "${id}" is already registered`);
    }
    if (!existsSync(repository)) {
      throw new Error(`Repository path does not exist: ${repository}`);
    }
    if (!existsSync(path.join(repository, '.git'))) {
      throw new Error(`Not a Git repository: ${repository}`);
    }
    const project: ProjectConfig = {
      id,
      name: opts.name ?? id,
      repository,
      paths: opts.paths ?? ['docs'],
    };
    data.projects.push(project);
    this.save(data);
    return project;
  }

  remove(id: string): void {
    const data = this.load();
    const next = data.projects.filter((p) => p.id !== id);
    if (next.length === data.projects.length) {
      throw new Error(`Project "${id}" is not registered`);
    }
    this.save({ projects: next });
  }

  private load(): ProjectRegistryData {
    if (!existsSync(this.registryPath)) {
      return { projects: [] };
    }
    return JSON.parse(readFileSync(this.registryPath, 'utf8')) as ProjectRegistryData;
  }

  private save(data: ProjectRegistryData): void {
    mkdirSync(path.dirname(this.registryPath), { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/projects/project-registry.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/projects tests/projects
git commit -m "feat: add project registry"
```

---

### Task 4: Content Hashing

**Files:**
- Create: `src/ingestion/hasher.ts`
- Test: `tests/ingestion/hasher.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `function hashContent(content: string): string` — used by the future incremental-sync indexer to diff file content.

- [ ] **Step 1: Write the failing test**

`tests/ingestion/hasher.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { hashContent } from '../../src/ingestion/hasher';

describe('hashContent', () => {
  it('produces the same hash for unchanged content', () => {
    expect(hashContent('hello world')).toBe(hashContent('hello world'));
  });

  it('produces a different hash for modified content', () => {
    expect(hashContent('hello world')).not.toBe(hashContent('hello world!'));
  });

  it('produces a 64-character hex SHA-256 digest', () => {
    expect(hashContent('hello world')).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/hasher.test.ts`
Expected: FAIL with "Cannot find module '../../src/ingestion/hasher'".

- [ ] **Step 3: Write minimal implementation**

`src/ingestion/hasher.ts`:

```typescript
import { createHash } from 'node:crypto';

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/hasher.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/hasher.ts tests/ingestion/hasher.test.ts
git commit -m "feat: add SHA-256 content hasher"
```

---

### Task 5: Markdown Scanner

**Files:**
- Create: `src/ingestion/scanner.ts`
- Test: `tests/ingestion/scanner.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `interface ScannedFile { relativePath: string; absolutePath: string }` and `function scanDocuments(repositoryRoot: string, paths: string[]): ScannedFile[]` — used by the future indexer to enumerate files to hash/chunk.

- [ ] **Step 1: Write the failing test**

`tests/ingestion/scanner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanDocuments } from '../../src/ingestion/scanner';

describe('scanDocuments', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-scanner-'));
    mkdirSync(path.join(dir, 'docs', 'steering'), { recursive: true });
    mkdirSync(path.join(dir, 'docs', 'node_modules'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'README.md'), '# Readme');
    writeFileSync(path.join(dir, 'docs', 'steering', 'architecture.md'), '# Architecture');
    writeFileSync(path.join(dir, 'docs', 'node_modules', 'ignored.md'), '# Ignored');
    writeFileSync(path.join(dir, 'docs', '.env'), 'SECRET=1');
    writeFileSync(path.join(dir, 'docs', 'logo.png'), 'binary');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds markdown files under configured paths', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath).sort();
    expect(files).toContain('docs/README.md');
    expect(files).toContain('docs/steering/architecture.md');
  });

  it('ignores excluded directories', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files).not.toContain('docs/node_modules/ignored.md');
  });

  it('ignores .env files', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files.some((f) => f.endsWith('.env'))).toBe(false);
  });

  it('ignores unsupported file extensions', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files.some((f) => f.endsWith('.png'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/scanner.test.ts`
Expected: FAIL with "Cannot find module '../../src/ingestion/scanner'".

- [ ] **Step 3: Write minimal implementation**

`src/ingestion/scanner.ts`:

```typescript
import { readdirSync } from 'node:fs';
import path from 'node:path';

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.md', '.mdx', '.txt']);
const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.claude',
  '.agents',
]);
const EXCLUDED_FILE_NAMES = new Set(['.env', 'CLAUDE.md', 'AGENTS.md']);

export function scanDocuments(repositoryRoot: string, paths: string[]): ScannedFile[] {
  const results: ScannedFile[] = [];
  for (const configuredPath of paths) {
    walk(repositoryRoot, path.join(repositoryRoot, configuredPath), results);
  }
  return results.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function walk(repositoryRoot: string, dir: string, results: ScannedFile[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      walk(repositoryRoot, path.join(dir, entry.name), results);
      continue;
    }
    if (EXCLUDED_FILE_NAMES.has(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/');
    results.push({ relativePath, absolutePath });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/scanner.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/scanner.ts tests/ingestion/scanner.test.ts
git commit -m "feat: add markdown document scanner"
```

---

### Task 6: Markdown Parser (heading-aware sections)

**Files:**
- Create: `src/ingestion/parser.ts`
- Test: `tests/ingestion/parser.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `interface MarkdownSection { title: string; heading: string; level: number; content: string }` and `function parseMarkdown(content: string): MarkdownSection[]` — consumed by Task 7's `chunkMarkdown`.

- [ ] **Step 1: Write the failing test**

`tests/ingestion/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../src/ingestion/parser';

describe('parseMarkdown', () => {
  it('splits content into sections at each heading and tracks the document title', () => {
    const md = '# Title\n\nIntro para.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.\n';
    const sections = parseMarkdown(md);

    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({ title: 'Title', heading: 'Title', level: 1 });
    expect(sections[0].content).toContain('Intro para.');
    expect(sections[1]).toMatchObject({ title: 'Title', heading: 'Section A', level: 2 });
    expect(sections[1].content).toContain('Content A.');
    expect(sections[2]).toMatchObject({ title: 'Title', heading: 'Section B', level: 2 });
    expect(sections[2].content).toContain('Content B.');
  });

  it('keeps content before the first heading as its own section', () => {
    const md = 'Preamble text.\n\n# Title\n\nBody.\n';
    const sections = parseMarkdown(md);

    expect(sections[0]).toMatchObject({ title: '', heading: '', level: 0 });
    expect(sections[0].content).toContain('Preamble text.');
    expect(sections[1]).toMatchObject({ title: 'Title', heading: 'Title', level: 1 });
  });

  it('returns no sections for empty content', () => {
    expect(parseMarkdown('')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/parser.test.ts`
Expected: FAIL with "Cannot find module '../../src/ingestion/parser'".

- [ ] **Step 3: Write minimal implementation**

`src/ingestion/parser.ts`:

```typescript
export interface MarkdownSection {
  title: string;
  heading: string;
  level: number;
  content: string;
}

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;

export function parseMarkdown(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];

  let currentLines: string[] = [];
  let currentHeading = '';
  let currentLevel = 0;
  let documentTitle = '';
  let started = false;

  const flush = () => {
    if (!started && currentLines.every((line) => line.trim() === '')) return;
    sections.push({
      title: documentTitle,
      heading: currentHeading,
      level: currentLevel,
      content: currentLines.join('\n'),
    });
  };

  for (const line of lines) {
    const match = HEADING_PATTERN.exec(line);
    if (match) {
      flush();
      currentLevel = match[1].length;
      currentHeading = match[2];
      if (currentLevel === 1 && !documentTitle) {
        documentTitle = currentHeading;
      }
      currentLines = [line];
      started = true;
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/parser.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/parser.ts tests/ingestion/parser.test.ts
git commit -m "feat: add heading-aware markdown parser"
```

---

### Task 7: Chunker

**Files:**
- Create: `src/ingestion/chunker.ts`
- Test: `tests/ingestion/chunker.test.ts`

**Interfaces:**
- Consumes: `parseMarkdown(content: string): MarkdownSection[]` from Task 6 (`src/ingestion/parser.ts`)
- Produces: `interface Chunk { title: string; section: string; content: string; chunkIndex: number }`, `interface ChunkOptions { chunkSize?: number; overlap?: number }`, and `function chunkMarkdown(content: string, options?: ChunkOptions): Chunk[]` — consumed by the future indexer before embedding.

- [ ] **Step 1: Write the failing test**

`tests/ingestion/chunker.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../../src/ingestion/chunker';

describe('chunkMarkdown', () => {
  it('preserves heading context on each chunk', () => {
    const md = '# Doc\n\n## Section A\n\nShort content.\n';
    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ title: 'Doc', section: 'Section A', chunkIndex: 1 });
  });

  it('splits long sections to respect the configured chunk size', () => {
    const body = 'a'.repeat(500);
    const md = `## Big\n\n${body}\n`;
    const chunks = chunkMarkdown(md, { chunkSize: 100, overlap: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(100);
    }
  });

  it('overlaps consecutive chunks from the same section', () => {
    const body = 'a'.repeat(500);
    const md = `## Big\n\n${body}\n`;
    const chunks = chunkMarkdown(md, { chunkSize: 100, overlap: 20 });

    expect(chunks[1].content.slice(0, 20)).toBe(chunks[0].content.slice(-20));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/chunker.test.ts`
Expected: FAIL with "Cannot find module '../../src/ingestion/chunker'".

- [ ] **Step 3: Write minimal implementation**

`src/ingestion/chunker.ts`:

```typescript
import { parseMarkdown } from './parser';

export interface Chunk {
  title: string;
  section: string;
  content: string;
  chunkIndex: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

// ponytail: char-count token approximation (~4 chars/token per init.md §8);
// swap for a real tokenizer if chunk boundaries ever need token precision
const DEFAULT_CHUNK_SIZE = 4000;
const DEFAULT_OVERLAP = 400;

export function chunkMarkdown(content: string, options: ChunkOptions = {}): Chunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;
  const sections = parseMarkdown(content);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    if (section.content.length <= chunkSize) {
      chunks.push({
        title: section.title,
        section: section.heading,
        content: section.content,
        chunkIndex: chunkIndex++,
      });
      continue;
    }
    let start = 0;
    while (start < section.content.length) {
      const end = Math.min(start + chunkSize, section.content.length);
      chunks.push({
        title: section.title,
        section: section.heading,
        content: section.content.slice(start, end),
        chunkIndex: chunkIndex++,
      });
      if (end >= section.content.length) break;
      start = end - overlap;
    }
  }

  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/chunker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/chunker.ts tests/ingestion/chunker.test.ts
git commit -m "feat: add structure-aware markdown chunker"
```

---

### Task 8: Embedding Provider Abstraction

**Files:**
- Create: `src/embedding/embedding-provider.ts`
- Test: `tests/embedding/embedding-provider.test.ts`

**Interfaces:**
- Consumes: nothing (takes a plain `EmbeddingConfig`, structurally compatible with the relevant fields of `AppConfig` from Task 2)
- Produces: `interface EmbeddingProvider { embedDocuments(texts: string[]): Promise<number[][]>; embedQuery(text: string): Promise<number[]> }`, `interface EmbeddingConfig { provider: 'ollama' | 'openai'; baseUrl: string; model: string; apiKey?: string }`, and `function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider` — consumed by the future indexer and retrieval layer.

- [ ] **Step 1: Write the failing test**

`tests/embedding/embedding-provider.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createEmbeddingProvider } from '../../src/embedding/embedding-provider';

describe('createEmbeddingProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws on an unknown provider', () => {
    expect(() =>
      createEmbeddingProvider({ provider: 'bogus' as any, baseUrl: 'http://x', model: 'm' }),
    ).toThrow('Unknown embedding provider');
  });

  it('ollama provider calls the /api/embeddings endpoint for a single query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });
    const result = await provider.embedQuery('hello');

    expect(result).toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('openai-compatible provider embeds multiple documents in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createEmbeddingProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      apiKey: 'sk-test',
    });
    const result = await provider.embedDocuments(['a', 'b']);

    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('throws a descriptive error when the embedding request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' }),
    );

    const provider = createEmbeddingProvider({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'bge-m3',
    });

    await expect(provider.embedQuery('hello')).rejects.toThrow('500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/embedding/embedding-provider.test.ts`
Expected: FAIL with "Cannot find module '../../src/embedding/embedding-provider'".

- [ ] **Step 3: Write minimal implementation**

`src/embedding/embedding-provider.ts`:

```typescript
export interface EmbeddingProvider {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export interface EmbeddingConfig {
  provider: 'ollama' | 'openai';
  baseUrl: string;
  model: string;
  apiKey?: string;
}

class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: EmbeddingConfig) {}

  embedDocuments(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embedOne(text)));
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }

  private async embedOne(text: string): Promise<number[]> {
    const res = await fetch(`${this.config.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embedding request failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  }
}

class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly config: EmbeddingConfig) {}

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const res = await this.request(texts);
    return res.data.map((item) => item.embedding);
  }

  async embedQuery(text: string): Promise<number[]> {
    const res = await this.request([text]);
    return res.data[0].embedding;
  }

  private async request(input: string[]): Promise<{ data: { embedding: number[] }[] }> {
    const res = await fetch(`${this.config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.config.model, input }),
    });
    if (!res.ok) {
      throw new Error(`Embedding request failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as { data: { embedding: number[] }[] };
  }
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  if (config.provider === 'ollama') return new OllamaEmbeddingProvider(config);
  if (config.provider === 'openai') return new OpenAICompatibleEmbeddingProvider(config);
  throw new Error(`Unknown embedding provider: ${config.provider}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/embedding/embedding-provider.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/embedding/embedding-provider.ts tests/embedding/embedding-provider.test.ts
git commit -m "feat: add pluggable embedding provider (ollama + openai-compatible)"
```

---

### Task 9: Qdrant Client Wrapper

**Files:**
- Create: `src/qdrant/qdrant-client.ts`
- Test: `tests/qdrant/qdrant-client.test.ts`

**Interfaces:**
- Consumes: `QdrantClient` type from the `@qdrant/js-client-rest` package (installed in Task 1)
- Produces: `interface QdrantConnectionConfig { url: string; collectionName: string; vectorSize: number }`, `function createQdrantClient(url: string): QdrantClient`, and `function ensureCollection(client: QdrantClient, config: QdrantConnectionConfig): Promise<void>` — consumed by the future Qdrant repository (Phase 2).

- [ ] **Step 1: Write the failing test**

`tests/qdrant/qdrant-client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ensureCollection } from '../../src/qdrant/qdrant-client';

describe('ensureCollection', () => {
  it('creates the collection when it does not exist', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue(true),
    } as any;

    await ensureCollection(client, { url: 'http://x', collectionName: 'docs', vectorSize: 4 });

    expect(client.createCollection).toHaveBeenCalledWith('docs', {
      vectors: { size: 4, distance: 'Cosine' },
    });
  });

  it('skips creation when the collection already exists', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      createCollection: vi.fn(),
    } as any;

    await ensureCollection(client, { url: 'http://x', collectionName: 'docs', vectorSize: 4 });

    expect(client.createCollection).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/qdrant/qdrant-client.test.ts`
Expected: FAIL with "Cannot find module '../../src/qdrant/qdrant-client'".

- [ ] **Step 3: Write minimal implementation**

`src/qdrant/qdrant-client.ts`:

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';

export interface QdrantConnectionConfig {
  url: string;
  collectionName: string;
  vectorSize: number;
}

export function createQdrantClient(url: string): QdrantClient {
  return new QdrantClient({ url });
}

export async function ensureCollection(
  client: QdrantClient,
  config: QdrantConnectionConfig,
): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === config.collectionName);
  if (!exists) {
    await client.createCollection(config.collectionName, {
      vectors: { size: config.vectorSize, distance: 'Cosine' },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/qdrant/qdrant-client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: all Phase 1 tests pass (23 tests across 7 test files), no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/qdrant/qdrant-client.ts tests/qdrant/qdrant-client.test.ts
git commit -m "feat: add qdrant client wrapper with ensureCollection"
```

---

### Task 10: Update Feature Docs to Reflect Phase 1

**Files:**
- Modify: `docs/features/01-project-registry-and-multi-project-support.md`
- Modify: `docs/features/02-ingestion-full-index.md` (partially — scanning/chunking/hashing pieces only; full ingestion orchestration is still Phase 2)
- Modify: `docs/features/README.md`

**Interfaces:**
- Consumes: nothing new — this is documentation only, per the `project-rag-feature-flow` skill's step 5 (docs updates are part of feature work, not follow-up).

- [ ] **Step 1: Update `docs/features/01-project-registry-and-multi-project-support.md`**

Change `**Status: Planned**` to `**Status: Implemented**` and update the "Related Files" section to reference the real paths: `src/projects/project-registry.ts`, `src/projects/project-types.ts`, `tests/projects/project-registry.test.ts`.

- [ ] **Step 2: Update `docs/features/02-ingestion-full-index.md`**

Add a note under "1) What This Feature Is": "Phase 1 delivered the scanner, hasher, parser, and chunker building blocks (`src/ingestion/{scanner,hasher,parser,chunker}.ts`); the full `project-rag ingest` orchestration (`src/ingestion/indexer.ts`) is still Phase 2." Keep `**Status: Planned**` since the orchestrator itself doesn't exist yet.

- [ ] **Step 3: Update `docs/features/README.md`**

Replace the `**Updated**:` line with today's date and replace the `**Recent**:` line with: "Phase 1 (Foundation) implemented: config, project registry, content hashing, markdown scanner/parser/chunker, embedding provider abstraction, Qdrant client wrapper — see `docs/superpowers/plans/2026-08-08-phase1-foundation.md`."

- [ ] **Step 4: Commit**

```bash
git add docs/features/01-project-registry-and-multi-project-support.md docs/features/02-ingestion-full-index.md docs/features/README.md
git commit -m "docs: mark Phase 1 features implemented"
```
