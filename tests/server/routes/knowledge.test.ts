import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

describe('GET /api/projects/:id/knowledge', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).get('/api/projects/missing/knowledge');

    expect(res.status).toBe(404);
  });

  it('returns the sorted list of indexed files, with per-file source and chunk counts', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/b.md', content_hash: 'h2', title: 'B' } },
          { id: '2', payload: { file: 'docs/a.md', content_hash: 'h1', title: 'A' } },
          { id: '3', payload: { file: 'docs/a.md', content_hash: 'h1', title: 'A' } },
          { id: '4', payload: { file: 'uploads/notes.md', content_hash: 'h3', title: 'Notes', source: 'upload', document_type: 'pdf' } },
        ],
        next_page_offset: null,
      }),
    };
    const app = createApp(baseDeps({ registry, qdrantClient }));

    const res = await request(app).get('/api/projects/sample/knowledge');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      files: ['docs/a.md', 'docs/b.md', 'uploads/notes.md'],
      chunkCount: 4,
      documents: [
        { file: 'docs/a.md', source: 'repository', documentType: 'markdown', chunkCount: 2, title: 'A' },
        { file: 'docs/b.md', source: 'repository', documentType: 'markdown', chunkCount: 1, title: 'B' },
        { file: 'uploads/notes.md', source: 'upload', documentType: 'pdf', chunkCount: 1, title: 'Notes' },
      ],
    });
  });

  it('returns 500 with a clean error body when Qdrant is unreachable', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      scroll: vi.fn().mockRejectedValue(new Error('fetch failed')),
    };
    const app = createApp(baseDeps({ registry, qdrantClient }));

    const res = await request(app).get('/api/projects/sample/knowledge');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fetch failed' });
  });
});
