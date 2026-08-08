import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

describe('GET /api/fs/roots', () => {
  it('returns at least one root and the home directory', async () => {
    const res = await request(createApp(baseDeps())).get('/api/fs/roots');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.roots)).toBe(true);
    expect(res.body.roots.length).toBeGreaterThan(0);
    expect(typeof res.body.home).toBe('string');
  });
});

describe('GET /api/fs/list', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-fs-browse-'));
    mkdirSync(path.join(dir, 'alpha'));
    mkdirSync(path.join(dir, 'beta'));
    mkdirSync(path.join(dir, '.hidden'));
    writeFileSync(path.join(dir, 'not-a-dir.txt'), 'x');
    mkdirSync(path.join(dir, 'beta', '.git'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists subdirectories, excluding files and dotfolders, sorted by name', async () => {
    const res = await request(createApp(baseDeps())).get('/api/fs/list').query({ path: dir });

    expect(res.status).toBe(200);
    expect(res.body.path).toBe(dir);
    expect(res.body.entries).toEqual([
      { name: 'alpha', path: path.join(dir, 'alpha'), isGitRepo: false },
      { name: 'beta', path: path.join(dir, 'beta'), isGitRepo: true },
    ]);
  });

  it('reports whether the browsed directory itself is a git repository', async () => {
    const res = await request(createApp(baseDeps())).get('/api/fs/list').query({ path: path.join(dir, 'beta') });

    expect(res.status).toBe(200);
    expect(res.body.isGitRepo).toBe(true);
  });

  it('returns the parent path, or null at a filesystem root', async () => {
    const child = await request(createApp(baseDeps())).get('/api/fs/list').query({ path: path.join(dir, 'alpha') });
    expect(child.body.parent).toBe(dir);

    const root = path.parse(dir).root;
    const atRoot = await request(createApp(baseDeps())).get('/api/fs/list').query({ path: root });
    expect(atRoot.body.parent).toBeNull();
  });

  it('rejects a relative path', async () => {
    const res = await request(createApp(baseDeps())).get('/api/fs/list').query({ path: 'relative/dir' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a path that does not exist', async () => {
    const res = await request(createApp(baseDeps()))
      .get('/api/fs/list')
      .query({ path: path.join(dir, 'does-not-exist') });
    expect(res.status).toBe(404);
  });

  it('rejects a missing path parameter', async () => {
    const res = await request(createApp(baseDeps())).get('/api/fs/list');
    expect(res.status).toBe(400);
  });
});
