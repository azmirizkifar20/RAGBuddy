import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

describe('POST /api/projects/:id/sync', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(baseDeps());

    const res = await request(app).post('/api/projects/missing/sync');

    expect(res.status).toBe(404);
  });
});
