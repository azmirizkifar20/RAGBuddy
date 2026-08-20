import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

function dashboardAuthStoreWith(overrides: Record<string, unknown> = {}) {
  return {
    isEnabled: vi.fn().mockReturnValue(false),
    enable: vi.fn().mockReturnValue('generated-session-token'),
    disable: vi.fn(),
    changeCode: vi.fn(),
    login: vi.fn().mockReturnValue(null),
    logout: vi.fn(),
    validateSession: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('GET /api/auth/status', () => {
  it('reports enabled: false, authenticated: true when the gate is off', async () => {
    const app = createApp(baseDeps({ dashboardAuthStore: dashboardAuthStoreWith({ isEnabled: vi.fn().mockReturnValue(false) }) }));

    const res = await request(app).get('/api/auth/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, authenticated: true });
  });

  it('reports authenticated: false when enabled and no session cookie is presented', async () => {
    const app = createApp(baseDeps({ dashboardAuthStore: dashboardAuthStoreWith({ isEnabled: vi.fn().mockReturnValue(true) }) }));

    const res = await request(app).get('/api/auth/status');

    expect(res.body).toEqual({ enabled: true, authenticated: false });
  });

  it('reports authenticated: true when enabled and a valid session cookie is presented', async () => {
    const dashboardAuthStore = dashboardAuthStoreWith({
      isEnabled: vi.fn().mockReturnValue(true),
      validateSession: vi.fn().mockReturnValue(true),
    });
    const app = createApp(baseDeps({ dashboardAuthStore }));

    const res = await request(app).get('/api/auth/status').set('Cookie', 'ragbuddy_session=valid-token');

    expect(res.body).toEqual({ enabled: true, authenticated: true });
    expect(dashboardAuthStore.validateSession).toHaveBeenCalledWith('valid-token');
  });
});

describe('POST /api/auth/login', () => {
  it('rejects a missing code', async () => {
    const app = createApp(baseDeps({ dashboardAuthStore: dashboardAuthStoreWith() }));

    const res = await request(app).post('/api/auth/login').send({});

    expect(res.status).toBe(400);
  });

  it('rejects a wrong code with 401 and no cookie', async () => {
    const dashboardAuthStore = dashboardAuthStoreWith({ login: vi.fn().mockReturnValue(null) });
    const app = createApp(baseDeps({ dashboardAuthStore }));

    const res = await request(app).post('/api/auth/login').send({ code: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('accepts the right code, sets a session cookie, and returns ok', async () => {
    const dashboardAuthStore = dashboardAuthStoreWith({ login: vi.fn().mockReturnValue('fresh-token') });
    const app = createApp(baseDeps({ dashboardAuthStore }));

    const res = await request(app).post('/api/auth/login').send({ code: 'right' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['set-cookie']?.[0]).toContain('ragbuddy_session=fresh-token');
  });

  it('is always reachable even when the dashboard gate is enabled (no auth loop)', async () => {
    const dashboardAuthStore = dashboardAuthStoreWith({
      isEnabled: vi.fn().mockReturnValue(true),
      login: vi.fn().mockReturnValue('fresh-token'),
    });
    const app = createApp(baseDeps({ dashboardAuthStore }));

    const res = await request(app).post('/api/auth/login').send({ code: 'right' });

    expect(res.status).toBe(200);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session and the cookie', async () => {
    const dashboardAuthStore = dashboardAuthStoreWith({ isEnabled: vi.fn().mockReturnValue(true) });
    const app = createApp(baseDeps({ dashboardAuthStore }));

    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(204);
    expect(dashboardAuthStore.logout).toHaveBeenCalled();
    expect(res.headers['set-cookie']?.[0]).toContain('Max-Age=0');
  });
});
