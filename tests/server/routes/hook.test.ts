import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn(), find: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn(), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('hook routes', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-hook-route-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST installs the hook for a registered project', async () => {
    const registry = { list: vi.fn(), find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }) };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).post('/api/projects/sample/hook');

    expect(res.status).toBe(204);
  });

  it('DELETE uninstalls the hook for a registered project', async () => {
    const registry = { list: vi.fn(), find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }) };
    const app = createApp(baseDeps({ registry }));
    await request(app).post('/api/projects/sample/hook');

    const res = await request(app).delete('/api/projects/sample/hook');

    expect(res.status).toBe(204);
  });

  it('returns 404 for an unregistered project on install', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/hook');

    expect(res.status).toBe(404);
  });
});
