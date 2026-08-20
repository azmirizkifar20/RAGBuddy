import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { baseDeps } from './test-deps';

function apiKeyStoreWith(key: string) {
  return { get: vi.fn().mockReturnValue(key), isConfigured: vi.fn().mockReturnValue(true), generate: vi.fn(), remove: vi.fn() };
}

describe('createApp — optional CORS + API key hardening', () => {
  it('sends no CORS headers when allowedOrigins is unset (default, unchanged behavior)', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).get('/api/config').set('Origin', 'http://external.test');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('echoes back an allowed origin and answers preflight requests', async () => {
    const app = createApp(baseDeps({ allowedOrigins: ['http://external.test'] }));

    const preflight = await request(app)
      .options('/api/config')
      .set('Origin', 'http://external.test')
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://external.test');

    const res = await request(app).get('/api/config').set('Origin', 'http://external.test');
    expect(res.headers['access-control-allow-origin']).toBe('http://external.test');
  });

  it('does not echo an origin that is not in the allowlist', async () => {
    const app = createApp(baseDeps({ allowedOrigins: ['http://external.test'] }));

    const res = await request(app).get('/api/config').set('Origin', 'http://untrusted.test');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows requests without an API key when none is configured (default, unchanged behavior)', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
  });

  it('rejects requests missing the API key once one is configured', async () => {
    const app = createApp(baseDeps({ apiKeyStore: apiKeyStoreWith('secret-key') }));

    const res = await request(app).get('/api/config');

    expect(res.status).toBe(401);
  });

  it('accepts a matching key via the Authorization bearer header', async () => {
    const app = createApp(baseDeps({ apiKeyStore: apiKeyStoreWith('secret-key') }));

    const res = await request(app).get('/api/config').set('Authorization', 'Bearer secret-key');

    expect(res.status).toBe(200);
  });

  it('accepts a matching key via the X-API-Key header', async () => {
    const app = createApp(baseDeps({ apiKeyStore: apiKeyStoreWith('secret-key') }));

    const res = await request(app).get('/api/config').set('X-API-Key', 'secret-key');

    expect(res.status).toBe(200);
  });

  it('rejects a wrong key', async () => {
    const app = createApp(baseDeps({ apiKeyStore: apiKeyStoreWith('secret-key') }));

    const res = await request(app).get('/api/config').set('X-API-Key', 'wrong-key');

    expect(res.status).toBe(401);
  });

  it('resolves the configured key fresh per request (no restart needed after a Settings change)', async () => {
    const store = apiKeyStoreWith('secret-key');
    const app = createApp(baseDeps({ apiKeyStore: store }));

    const before = await request(app).get('/api/config');
    expect(before.status).toBe(401);

    store.get.mockReturnValue(undefined); // simulate removing the key via Settings
    const after = await request(app).get('/api/config');
    expect(after.status).toBe(200);
  });
});
