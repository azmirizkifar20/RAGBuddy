import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
        {
          file: 'docs/a.md',
          source: 'repository',
          documentType: 'markdown',
          chunkCount: 2,
          title: 'A',
          gitCommit: null,
          commitsBehind: null,
          stale: false,
        },
        {
          file: 'docs/b.md',
          source: 'repository',
          documentType: 'markdown',
          chunkCount: 1,
          title: 'B',
          gitCommit: null,
          commitsBehind: null,
          stale: false,
        },
        {
          file: 'uploads/notes.md',
          source: 'upload',
          documentType: 'pdf',
          chunkCount: 1,
          title: 'Notes',
          gitCommit: null,
          commitsBehind: null,
          stale: false,
        },
      ],
    });
  });

  it('flags a document stale once the repo has moved many commits past its indexed commit', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-knowledge-stale-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(path.join(dir, 'file.txt'), 'init');
      execFileSync('git', ['add', '.'], { cwd: dir });
      execFileSync('git', ['commit', '-m', 'first'], { cwd: dir });
      const firstCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      for (let i = 0; i < 25; i++) {
        writeFileSync(path.join(dir, 'file.txt'), String(i));
        execFileSync('git', ['commit', '-am', `change ${i}`], { cwd: dir });
      }

      const registry = {
        list: vi.fn(),
        find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: dir, paths: ['docs'] }),
      };
      const qdrantClient = {
        getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
        scroll: vi.fn().mockResolvedValue({
          points: [{ id: '1', payload: { file: 'docs/a.md', title: 'A', git_commit: firstCommit } }],
          next_page_offset: null,
        }),
      };
      const app = createApp(baseDeps({ registry, qdrantClient }));

      const res = await request(app).get('/api/projects/sample/knowledge');

      expect(res.status).toBe(200);
      expect(res.body.documents[0].commitsBehind).toBe(25);
      expect(res.body.documents[0].stale).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not flag a document stale when only a few commits have landed since', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-knowledge-fresh-'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
      writeFileSync(path.join(dir, 'file.txt'), '0');
      execFileSync('git', ['add', '.'], { cwd: dir });
      execFileSync('git', ['commit', '-m', 'first'], { cwd: dir });
      const firstCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
      writeFileSync(path.join(dir, 'file.txt'), '1');
      execFileSync('git', ['commit', '-am', 'second'], { cwd: dir });

      const registry = {
        list: vi.fn(),
        find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: dir, paths: ['docs'] }),
      };
      const qdrantClient = {
        getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
        scroll: vi.fn().mockResolvedValue({
          points: [{ id: '1', payload: { file: 'docs/a.md', title: 'A', git_commit: firstCommit } }],
          next_page_offset: null,
        }),
      };
      const app = createApp(baseDeps({ registry, qdrantClient }));

      const res = await request(app).get('/api/projects/sample/knowledge');

      expect(res.body.documents[0].commitsBehind).toBe(1);
      expect(res.body.documents[0].stale).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
