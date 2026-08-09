import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';
import { uploadsDirFor } from '../../../src/ingestion/uploads';

const sample = { id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] };

describe('project upload routes', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-upload-routes-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function appWithProject(overrides: Record<string, unknown> = {}) {
    return createApp(
      baseDeps({
        registry: { list: vi.fn(), find: vi.fn().mockReturnValue(sample) },
        qdrantClient: {
          getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
          createCollection: vi.fn().mockResolvedValue(true),
          delete: vi.fn().mockResolvedValue(true),
          upsert: vi.fn().mockResolvedValue(true),
        },
        embeddingProvider: {
          embedDocuments: vi.fn().mockResolvedValue([[0.1, 0.2]]),
          embedQuery: vi.fn(),
        },
        dataDir,
        ...overrides,
      }),
    );
  }

  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps({ registry: { list: vi.fn(), find: vi.fn() } }));

    expect((await request(app).get('/api/projects/missing/uploads')).status).toBe(404);
    expect((await request(app).post('/api/projects/missing/uploads').send({ filename: 'a.md', content: 'x' })).status).toBe(404);
  });

  it('uploads, lists, then removes a document', async () => {
    const app = appWithProject();

    const created = await request(app)
      .post('/api/projects/sample/uploads')
      .send({ filename: 'notes.md', content: '# Notes\n\nBody.\n' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ file: 'uploads/notes.md', chunksIndexed: 1, replaced: false, documentType: 'markdown', truncated: false });

    const listed = await request(app).get('/api/projects/sample/uploads');
    expect(listed.status).toBe(200);
    expect(listed.body.uploads).toEqual([expect.objectContaining({ name: 'notes.md' })]);

    const removed = await request(app).delete('/api/projects/sample/uploads/notes.md');
    expect(removed.status).toBe(204);
    expect(existsSync(path.join(uploadsDirFor(dataDir, 'sample'), 'notes.md'))).toBe(false);
  });

  it('rejects a missing body with 400', async () => {
    const res = await request(appWithProject()).post('/api/projects/sample/uploads').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('filename and content (or data) are required');
  });

  it('rejects an unsupported file type with 400', async () => {
    const res = await request(appWithProject())
      .post('/api/projects/sample/uploads')
      .send({ filename: 'run.exe', content: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unsupported file type');
  });

  it('records the upload in the sync history', async () => {
    const history = { append: vi.fn(), list: vi.fn().mockReturnValue([]) };
    const app = appWithProject({ history });

    await request(app).post('/api/projects/sample/uploads').send({ filename: 'notes.md', content: '# Notes\n' });

    expect(history.append).toHaveBeenCalledWith(
      expect.objectContaining({ project: 'sample', kind: 'upload', trigger: 'web', status: 'success' }),
    );
  });
});

describe('GET /api/projects/:id/history', () => {
  it('returns the project-scoped run list', async () => {
    const runs = [{ id: '1', project: 'sample', kind: 'sync', status: 'success' }];
    const history = { append: vi.fn(), list: vi.fn().mockReturnValue(runs) };
    const app = createApp(
      baseDeps({ registry: { list: vi.fn(), find: vi.fn().mockReturnValue(sample) }, history }),
    );

    const res = await request(app).get('/api/projects/sample/history?limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ runs });
    expect(history.list).toHaveBeenCalledWith({ project: 'sample', limit: 10 });
  });

  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps({ registry: { list: vi.fn(), find: vi.fn() } }));
    expect((await request(app).get('/api/projects/missing/history')).status).toBe(404);
  });
});

describe('GET /api/config', () => {
  it('exposes runtime settings but never the embedding API key', async () => {
    const res = await request(createApp(baseDeps({ embeddingApiKey: 'sk-secret' }))).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      qdrantCollection: 'ragbuddy_documents',
      embeddingModel: 'bge-m3',
      embeddingApiKeyConfigured: false,
    });
    expect(JSON.stringify(res.body)).not.toContain('sk-secret');
  });
});

describe('GET /api/activity', () => {
  it('returns the cross-project run feed', async () => {
    const history = { append: vi.fn(), list: vi.fn().mockReturnValue([]) };
    const res = await request(createApp(baseDeps({ history }))).get('/api/activity?limit=5');

    expect(res.status).toBe(200);
    expect(history.list).toHaveBeenCalledWith({ limit: 5 });
  });
});
