import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';

function baseDeps(overrides: any = {}) {
  return {
    registry: { list: vi.fn(), find: vi.fn() },
    qdrantClient: {},
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'project_rag_documents',
    embeddingProvider: { embedQuery: vi.fn().mockResolvedValue([0.1]), embedDocuments: vi.fn() },
    ragTopK: 5,
    staticDir: '/tmp/does-not-matter',
    ...overrides,
  };
}

describe('POST /api/projects/:id/search', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/search').send({ query: 'hello' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when query is missing', async () => {
    const registry = { list: vi.fn(), find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }) };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).post('/api/projects/sample/search').send({});

    expect(res.status).toBe(400);
  });

  it('returns search results for a registered project', async () => {
    const registry = { list: vi.fn(), find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }) };
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [{ id: '1', score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'hi' } }],
      }),
    };
    const app = createApp(baseDeps({ registry, qdrantClient }));

    const res = await request(app).post('/api/projects/sample/search').send({ query: 'hello' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ results: [{ file: 'docs/a.md', section: 'Intro', score: 0.9, content: 'hi' }] });
  });
});
