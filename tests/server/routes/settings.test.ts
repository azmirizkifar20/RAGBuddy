import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';
import { CredentialsStore, type CredentialSeed } from '../../../src/config/credentials-store';
import { ApiKeyStore } from '../../../src/config/api-key-store';

const SEED: CredentialSeed = { name: 'Default', provider: 'ollama', baseUrl: 'http://localhost:11434', models: ['llama3'] };
const tempDirs: string[] = [];

function freshChatStore(seed: CredentialSeed = SEED) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-chat-creds-'));
  tempDirs.push(dir);
  return new CredentialsStore(path.join(dir, 'creds.json'), seed);
}

function freshApiKeyStore(seed?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-api-key-'));
  tempDirs.push(dir);
  return new ApiKeyStore(path.join(dir, 'api-key.json'), seed);
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('GET /api/settings/chat', () => {
  it('returns the seeded credential list without any apiKey', async () => {
    const chatCredentials = freshChatStore({ ...SEED, apiKey: 'sk-seed' });
    const app = createApp(baseDeps({ chatCredentials }));

    const res = await request(app).get('/api/settings/chat');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      credentials: [{ id: 'default', name: 'Default', provider: 'ollama', baseUrl: 'http://localhost:11434', apiKeyConfigured: true, models: ['llama3'] }],
      activeCredentialId: 'default',
      activeModel: 'llama3',
    });
  });
});

describe('POST /api/settings/chat (add credential)', () => {
  it('rejects an invalid provider', async () => {
    const app = createApp(baseDeps({ chatCredentials: freshChatStore() }));

    const res = await request(app)
      .post('/api/settings/chat')
      .send({ name: 'New', provider: 'bogus', baseUrl: 'http://x', models: ['m'] });

    expect(res.status).toBe(400);
  });

  it('rejects a missing name, baseUrl, or models', async () => {
    const app = createApp(baseDeps({ chatCredentials: freshChatStore() }));

    const missingName = await request(app).post('/api/settings/chat').send({ provider: 'ollama', baseUrl: 'http://x', models: ['m'] });
    expect(missingName.status).toBe(400);

    const missingBaseUrl = await request(app).post('/api/settings/chat').send({ name: 'N', provider: 'ollama', models: ['m'] });
    expect(missingBaseUrl.status).toBe(400);

    const missingModels = await request(app).post('/api/settings/chat').send({ name: 'N', provider: 'ollama', baseUrl: 'http://x' });
    expect(missingModels.status).toBe(400);
  });

  it('adds a credential and it appears in a subsequent list, without exposing the apiKey', async () => {
    const chatCredentials = freshChatStore();
    const app = createApp(baseDeps({ chatCredentials }));

    const res = await request(app)
      .post('/api/settings/chat')
      .send({ name: 'Gemini proxy', provider: 'openai', baseUrl: 'https://proxy.example.com/v1', apiKey: 'sk-new', models: ['gpt-4o'] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Gemini proxy', apiKeyConfigured: true, models: ['gpt-4o'] });
    expect(res.body.apiKey).toBeUndefined();

    const list = await request(app).get('/api/settings/chat');
    expect(list.body.credentials.map((c: any) => c.name)).toEqual(['Default', 'Gemini proxy']);
  });
});

describe('PUT /api/settings/chat/:id (update credential)', () => {
  it('returns 404 for an unknown id', async () => {
    const app = createApp(baseDeps({ chatCredentials: freshChatStore() }));
    const res = await request(app).put('/api/settings/chat/nope').send({ name: 'Renamed' });
    expect(res.status).toBe(404);
  });

  it('keeps the existing apiKey when the update omits it', async () => {
    const chatCredentials = freshChatStore({ ...SEED, apiKey: 'sk-old' });
    const app = createApp(baseDeps({ chatCredentials }));

    const res = await request(app).put('/api/settings/chat/default').send({ name: 'Renamed' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
    expect(chatCredentials.getRawApiKey('default')).toBe('sk-old');
  });
});

describe('DELETE /api/settings/chat/:id and POST /:id/activate', () => {
  it('removes a credential', async () => {
    const chatCredentials = freshChatStore();
    const app = createApp(baseDeps({ chatCredentials }));

    const res = await request(app).delete('/api/settings/chat/default');

    expect(res.status).toBe(204);
    expect((await request(app).get('/api/settings/chat')).body.credentials).toEqual([]);
  });

  it('activates a different model on the credential', async () => {
    const chatCredentials = freshChatStore({ ...SEED, models: ['llama3', 'qwen2.5'] });
    const app = createApp(baseDeps({ chatCredentials }));

    const res = await request(app).post('/api/settings/chat/default/activate').send({ model: 'qwen2.5' });

    expect(res.status).toBe(200);
    expect(res.body.activeModel).toBe('qwen2.5');
  });

  it('rejects activating a model the credential does not have', async () => {
    const app = createApp(baseDeps({ chatCredentials: freshChatStore() }));

    const res = await request(app).post('/api/settings/chat/default/activate').send({ model: 'not-real' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/settings/chat/test', () => {
  it('rejects an invalid body', async () => {
    const app = createApp(baseDeps({ chatCredentials: freshChatStore() }));
    const res = await request(app).post('/api/settings/chat/test').send({ provider: 'ollama' });
    expect(res.status).toBe(400);
  });

  it('reports ok with a latency when the provider responds successfully', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: 'pong' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(baseDeps({ chatCredentials: freshChatStore() }));

    const res = await request(app)
      .post('/api/settings/chat/test')
      .send({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.latencyMs).toBe('number');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init.body).stream).toBe(false);
  });

  it('reports the upstream error when the provider responds with a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401, statusText: 'Unauthorized' })));
    const app = createApp(baseDeps({ chatCredentials: freshChatStore() }));

    const res = await request(app)
      .post('/api/settings/chat/test')
      .send({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-bad' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('401');
  });

  it('falls back to a saved credential\'s apiKey (by id) when the test request omits one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const chatCredentials = freshChatStore({ ...SEED, provider: 'openai', apiKey: 'sk-saved' });
    const app = createApp(baseDeps({ chatCredentials }));

    await request(app)
      .post('/api/settings/chat/test')
      .send({ id: 'default', provider: 'openai', baseUrl: 'http://localhost:11434', model: 'llama3' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-saved');
  });
});

describe('POST /api/settings/embedding/test', () => {
  it('runs a real embedQuery against the resolved provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(baseDeps());

    const res = await request(app)
      .post('/api/settings/embedding/test')
      .send({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'bge-m3' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/embeddings');
    expect(JSON.parse(init.body).prompt).toBe('ping');
  });
});

describe('GET/POST/DELETE /api/settings/api-key', () => {
  it('reports not configured by default, never exposing the raw key', async () => {
    const app = createApp(baseDeps({ apiKeyStore: freshApiKeyStore() }));

    const res = await request(app).get('/api/settings/api-key');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  it('reports configured: true once a key is seeded, still without exposing it', async () => {
    const app = createApp(baseDeps({ apiKeyStore: freshApiKeyStore('seeded-key') }));

    // Once a key is configured, checking its status requires the key too, like every other
    // /api endpoint — this route gets no special bypass, or anyone could probe/reset it unauthenticated.
    const res = await request(app).get('/api/settings/api-key').set('X-API-Key', 'seeded-key');

    expect(res.body).toEqual({ configured: true });
  });

  it('rejects checking the key status without presenting the already-configured key', async () => {
    const app = createApp(baseDeps({ apiKeyStore: freshApiKeyStore('seeded-key') }));

    const res = await request(app).get('/api/settings/api-key');

    expect(res.status).toBe(401);
  });

  it('generates a new key, returns it once, and immediately requires it on other requests', async () => {
    const apiKeyStore = freshApiKeyStore();
    const app = createApp(baseDeps({ apiKeyStore }));

    const generated = await request(app).post('/api/settings/api-key/generate').send({});
    expect(generated.status).toBe(200);
    expect(typeof generated.body.apiKey).toBe('string');
    expect(generated.body.apiKey.length).toBeGreaterThan(0);

    const unauthenticated = await request(app).get('/api/config');
    expect(unauthenticated.status).toBe(401);

    const authenticated = await request(app).get('/api/config').set('X-API-Key', generated.body.apiKey);
    expect(authenticated.status).toBe(200);
  });

  it('rejects removing the key without presenting it first', async () => {
    const apiKeyStore = freshApiKeyStore('seeded-key');
    const app = createApp(baseDeps({ apiKeyStore }));

    const res = await request(app).delete('/api/settings/api-key');

    expect(res.status).toBe(401);
  });

  it('removes a configured key when the current key is presented, reopening the API without auth', async () => {
    const apiKeyStore = freshApiKeyStore('seeded-key');
    const app = createApp(baseDeps({ apiKeyStore }));

    expect((await request(app).get('/api/config')).status).toBe(401);

    const res = await request(app).delete('/api/settings/api-key').set('X-API-Key', 'seeded-key');
    expect(res.status).toBe(204);

    expect((await request(app).get('/api/config')).status).toBe(200);
    expect((await request(app).get('/api/settings/api-key')).body).toEqual({ configured: false });
  });
});

describe('GET /api/settings/qdrant', () => {
  it('reports exists: false without calling getCollection when the collection is missing', async () => {
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      getCollection: vi.fn(),
    };
    const registry = { list: vi.fn().mockReturnValue([{ id: 'a' }, { id: 'b' }]), find: vi.fn() };
    const app = createApp(baseDeps({ qdrantClient, registry, qdrantCollection: 'ragbuddy_documents' }));

    const res = await request(app).get('/api/settings/qdrant');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      collection: 'ragbuddy_documents',
      exists: false,
      affectedProjectIds: ['a', 'b'],
    });
    expect(qdrantClient.getCollection).not.toHaveBeenCalled();
  });

  it('reports vector size and point count when the collection exists', async () => {
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      getCollection: vi.fn().mockResolvedValue({
        points_count: 1226,
        config: { params: { vectors: { size: 3072 } } },
      }),
    };
    const registry = { list: vi.fn().mockReturnValue([{ id: 'project-rag' }]), find: vi.fn() };
    const app = createApp(baseDeps({ qdrantClient, registry, qdrantCollection: 'ragbuddy_documents' }));

    const res = await request(app).get('/api/settings/qdrant');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      collection: 'ragbuddy_documents',
      exists: true,
      vectorSize: 3072,
      pointsCount: 1226,
      affectedProjectIds: ['project-rag'],
    });
  });
});

describe('POST /api/settings/qdrant/drop-collection', () => {
  it('rejects without an explicit confirm: true', async () => {
    const qdrantClient = { getCollections: vi.fn(), deleteCollection: vi.fn() };
    const app = createApp(baseDeps({ qdrantClient }));

    const res = await request(app).post('/api/settings/qdrant/drop-collection').send({});

    expect(res.status).toBe(400);
    expect(qdrantClient.deleteCollection).not.toHaveBeenCalled();
  });

  it('drops the collection and reports affected projects when confirmed', async () => {
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      deleteCollection: vi.fn().mockResolvedValue(true),
    };
    const registry = { list: vi.fn().mockReturnValue([{ id: 'a' }, { id: 'b' }]), find: vi.fn() };
    const app = createApp(baseDeps({ qdrantClient, registry, qdrantCollection: 'ragbuddy_documents' }));

    const res = await request(app).post('/api/settings/qdrant/drop-collection').send({ confirm: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dropped: true, affectedProjectIds: ['a', 'b'] });
    expect(qdrantClient.deleteCollection).toHaveBeenCalledWith('ragbuddy_documents');
  });
});
