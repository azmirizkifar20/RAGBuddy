import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../src/server/app';
import { baseDeps } from './test-deps';

/** Locks the production URL layout: `/` answers the static landing page when `landingDir` is
 *  configured (mounted before the SPA bundle), the SPA keeps serving its own hashed assets, and
 *  every client route (`/login`, `/dashboard`, deep links) falls through to the SPA shell. */
describe('createApp — landing page + SPA static serving', () => {
  let landingDir: string;
  let staticDir: string;

  beforeEach(() => {
    landingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragbuddy-landing-'));
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragbuddy-static-'));
    fs.writeFileSync(path.join(landingDir, 'index.html'), '<html>LANDING-MARKER</html>');
    fs.mkdirSync(path.join(landingDir, 'images'));
    fs.writeFileSync(path.join(landingDir, 'images', 'x.webp'), 'webp-bytes');
    fs.mkdirSync(path.join(landingDir, 'fonts'));
    fs.writeFileSync(path.join(landingDir, 'fonts', 'geist.woff2'), 'font-bytes');
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<html>SPA-MARKER</html>');
    fs.mkdirSync(path.join(staticDir, 'assets'));
    fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
    fs.writeFileSync(path.join(staticDir, 'icon.png'), 'icon-bytes');
  });

  afterEach(() => {
    fs.rmSync(landingDir, { recursive: true, force: true });
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  it('serves the landing index.html at / when landingDir is configured', async () => {
    const app = createApp(baseDeps({ landingDir, staticDir }));

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('LANDING-MARKER');
  });

  it('serves landing assets (images/ + fonts/) from the landing dir', async () => {
    const app = createApp(baseDeps({ landingDir, staticDir }));

    expect((await request(app).get('/images/x.webp')).status).toBe(200);
    expect((await request(app).get('/fonts/geist.woff2')).status).toBe(200);
  });

  it('still serves SPA assets that only exist in the SPA bundle', async () => {
    const app = createApp(baseDeps({ landingDir, staticDir }));

    expect((await request(app).get('/assets/app.js')).status).toBe(200);
    expect((await request(app).get('/icon.png')).status).toBe(200);
  });

  it.each(['/login', '/dashboard', '/dashboard/chat', '/dashboard/projects/p1/documents'])(
    'falls through to the SPA shell for client route %s',
    async (url) => {
      const app = createApp(baseDeps({ landingDir, staticDir }));

      const res = await request(app).get(url);

      expect(res.status).toBe(200);
      expect(res.text).toContain('SPA-MARKER');
    },
  );

  it('serves the SPA shell at / when landingDir is not configured (pre-landing behavior)', async () => {
    const app = createApp(baseDeps({ staticDir }));

    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('SPA-MARKER');
  });
});
