import { describe, it, expect, vi } from 'vitest';
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

describe('POST /api/projects/:id/sync', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/sync');

    expect(res.status).toBe(404);
  });
});
