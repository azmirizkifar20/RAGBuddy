import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/settings/chat', () => {
  it('returns the current chat settings without the API key', async () => {
    const chatSettings = {
      get: vi.fn(),
      getPublic: vi
        .fn()
        .mockReturnValue({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKeyConfigured: true }),
      save: vi.fn(),
    };
    const app = createApp(baseDeps({ chatSettings }));

    const res = await request(app).get('/api/settings/chat');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      provider: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-4o-mini',
      apiKeyConfigured: true,
    });
  });
});

describe('PUT /api/settings/chat', () => {
  it('rejects an invalid provider', async () => {
    const app = createApp(baseDeps());

    const res = await request(app)
      .put('/api/settings/chat')
      .send({ provider: 'bogus', baseUrl: 'http://x', model: 'm' });

    expect(res.status).toBe(400);
  });

  it('rejects a missing baseUrl or model', async () => {
    const app = createApp(baseDeps());

    const missingBaseUrl = await request(app).put('/api/settings/chat').send({ provider: 'ollama', model: 'm' });
    expect(missingBaseUrl.status).toBe(400);

    const missingModel = await request(app).put('/api/settings/chat').send({ provider: 'ollama', baseUrl: 'http://x' });
    expect(missingModel.status).toBe(400);
  });

  it('saves valid settings and returns the updated public view', async () => {
    const chatSettings = {
      get: vi.fn(),
      getPublic: vi
        .fn()
        .mockReturnValue({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o', apiKeyConfigured: true }),
      save: vi.fn(),
    };
    const app = createApp(baseDeps({ chatSettings }));

    const res = await request(app)
      .put('/api/settings/chat')
      .send({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o', apiKey: 'sk-test' });

    expect(res.status).toBe(200);
    expect(chatSettings.save).toHaveBeenCalledWith({
      provider: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-4o',
      apiKey: 'sk-test',
    });
    expect(res.body.apiKeyConfigured).toBe(true);
  });
});

describe('POST /api/settings/chat/test', () => {
  it('rejects an invalid body the same way as PUT', async () => {
    const app = createApp(baseDeps());
    const res = await request(app).post('/api/settings/chat/test').send({ provider: 'ollama' });
    expect(res.status).toBe(400);
  });

  it('reports ok with a latency when the provider responds successfully', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: 'pong' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(baseDeps());

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
    const app = createApp(baseDeps());

    const res = await request(app)
      .post('/api/settings/chat/test')
      .send({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-bad' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toContain('401');
  });

  it('falls back to the already-saved API key when the test request omits one', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const chatSettings = {
      get: vi.fn().mockReturnValue({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-saved' }),
      getPublic: vi.fn(),
      save: vi.fn(),
    };
    const app = createApp(baseDeps({ chatSettings }));

    await request(app)
      .post('/api/settings/chat/test')
      .send({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer sk-saved');
  });
});
