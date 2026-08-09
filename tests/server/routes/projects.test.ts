import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

describe('GET /api/projects', () => {
  it('returns each project with indexed file count and hook status', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }]),
      find: vi.fn(),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    };
    const deps = baseDeps({ registry, qdrantClient });
    const app = createApp(deps);

    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'sample',
        name: 'Sample',
        repository: '/r',
        paths: ['docs'],
        indexedFileCount: expect.any(Number),
        chunkCount: 0,
        uploadCount: 0,
        hookInstalled: false,
        lastRunAt: null,
      },
    ]);
  });

  it('returns 500 with a clean error body when Qdrant is unreachable', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }]),
      find: vi.fn(),
    };
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      scroll: vi.fn().mockRejectedValue(new Error('fetch failed')),
    };
    const app = createApp(baseDeps({ registry, qdrantClient }));

    const res = await request(app).get('/api/projects');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fetch failed' });
  });
});

describe('GET /api/projects/:id', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).get('/api/projects/missing');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Project "missing" is not registered' });
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

    const res = await request(app).get('/api/projects/sample');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fetch failed' });
  });
});

describe('POST /api/projects', () => {
  it('registers a project and returns 201', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn(),
      register: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).post('/api/projects').send({ id: 'sample', repository: '/r', name: 'Sample' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] });
    expect(registry.register).toHaveBeenCalledWith('sample', '/r', { name: 'Sample', paths: undefined });
  });

  it('returns 400 when id or repository is missing', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects').send({ id: 'sample' });

    expect(res.status).toBe(400);
  });

  it('returns 400 when the registry rejects the input', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn(),
      register: vi.fn().mockImplementation(() => {
        throw new Error('Repository path does not exist: /r');
      }),
    };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).post('/api/projects').send({ id: 'sample', repository: '/r' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Repository path does not exist: /r' });
  });
});

describe('DELETE /api/projects/:id', () => {
  it('removes a project and returns 204', async () => {
    const registry = { list: vi.fn(), find: vi.fn(), remove: vi.fn() };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).delete('/api/projects/sample');

    expect(res.status).toBe(204);
    expect(registry.remove).toHaveBeenCalledWith('sample');
  });

  it('returns 404 when the project is not registered', async () => {
    const registry = {
      list: vi.fn(),
      find: vi.fn(),
      remove: vi.fn().mockImplementation(() => {
        throw new Error('Project "sample" is not registered');
      }),
    };
    const app = createApp(baseDeps({ registry }));

    const res = await request(app).delete('/api/projects/sample');

    expect(res.status).toBe(404);
  });
});
