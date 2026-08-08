import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn().mockReturnValue([]), find: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn(), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('GET /api/projects/:id/knowledge', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).get('/api/projects/missing/knowledge');

    expect(res.status).toBe(404);
  });

  it('returns the sorted list of indexed files for a registered project', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'project_rag_documents' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/b.md', content_hash: 'h2' } },
          { id: '2', payload: { file: 'docs/a.md', content_hash: 'h1' } },
        ],
        next_page_offset: null,
      }),
    };
    const app = createApp(baseDeps({ registry, qdrantClient }));

    const res = await request(app).get('/api/projects/sample/knowledge');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ files: ['docs/a.md', 'docs/b.md'] });
  });

  it('returns 500 with a clean error body when Qdrant is unreachable', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'project_rag_documents' }] }),
      scroll: vi.fn().mockRejectedValue(new Error('fetch failed')),
    };
    const app = createApp(baseDeps({ registry, qdrantClient }));

    const res = await request(app).get('/api/projects/sample/knowledge');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fetch failed' });
  });
});
