import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildProjectContext } from '../../src/context/project-context';

describe('buildProjectContext', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-context-'));
    mkdirSync(path.join(dir, 'docs', 'steering'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const project = () => ({ id: 'sample', name: 'Sample', repository: dir, paths: ['docs'] });

  function qdrantStub(points: { file: string; source?: string; document_type?: string; title?: string }[]) {
    return {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'project_rag_documents' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: points.map((p, i) => ({ id: String(i), payload: p })),
        next_page_offset: null,
      }),
    } as any;
  }

  it('returns project identity and repository name without leaking the absolute path', async () => {
    const result = await buildProjectContext(project(), {
      qdrantClient: qdrantStub([]),
      qdrantCollection: 'project_rag_documents',
    });

    expect(result.project).toEqual({ id: 'sample', name: 'Sample' });
    expect(result.repository.name).toBe(path.basename(dir));
    expect(JSON.stringify(result)).not.toContain(dir.replace(/\\/g, '/'));
  });

  it('includes a truncated overview when README.md exists', async () => {
    writeFileSync(path.join(dir, 'README.md'), `# Title\n\n${'word '.repeat(500)}`);

    const result = await buildProjectContext(project(), {
      qdrantClient: qdrantStub([]),
      qdrantCollection: 'project_rag_documents',
    });

    expect(result.overview).toBeDefined();
    expect(result.overview!.length).toBeLessThan(500 * 5);
    expect(result.overview).not.toContain('# Title');
  });

  it('omits missing steering documents instead of failing', async () => {
    writeFileSync(path.join(dir, 'docs', 'steering', 'architecture.md'), '# Architecture\n\nLayered.\n');

    const result = await buildProjectContext(project(), {
      qdrantClient: qdrantStub([]),
      qdrantCollection: 'project_rag_documents',
    });

    expect(result.steering.architecture).toContain('Layered.');
    expect(result.steering.techStack).toBeUndefined();
    expect(result.documentation.importantDocuments).toEqual(['docs/steering/architecture.md']);
  });

  it('builds a documentation inventory categorized by parent folder', async () => {
    const result = await buildProjectContext(project(), {
      qdrantClient: qdrantStub([
        { file: 'docs/features/01-a.md' },
        { file: 'docs/features/02-b.md' },
        { file: 'docs/steering/tech-stack.md' },
        { file: 'README.md' },
      ]),
      qdrantCollection: 'project_rag_documents',
    });

    expect(result.documentation.total).toBe(4);
    expect(result.documentation.categories).toEqual({ features: 2, steering: 1, root: 1 });
  });

  it('reports git as unavailable for a non-Git repository', async () => {
    const result = await buildProjectContext(project(), {
      qdrantClient: qdrantStub([]),
      qdrantCollection: 'project_rag_documents',
    });

    expect(result.git).toEqual({ available: false });
  });

  it('reports git branch, commit and dirty state for a real repository', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    writeFileSync(path.join(dir, 'file.txt'), 'hello');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    writeFileSync(path.join(dir, 'file.txt'), 'changed');

    const result = await buildProjectContext(project(), {
      qdrantClient: qdrantStub([]),
      qdrantCollection: 'project_rag_documents',
    });

    expect(result.git).toMatchObject({ available: true, branch: 'main', dirty: true });
    if (result.git.available) {
      expect(result.git.commit).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('does not fail when Qdrant is unavailable', async () => {
    const qdrantClient = {
      getCollections: vi.fn().mockRejectedValue(new Error('connection refused')),
    } as any;

    const result = await buildProjectContext(project(), {
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
    });

    expect(result.documentation).toEqual({ total: 0, categories: {}, importantDocuments: [] });
  });
});
