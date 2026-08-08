import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

describe('POST /api/projects/:id/ingest', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/ingest');

    expect(res.status).toBe(404);
  });
});
