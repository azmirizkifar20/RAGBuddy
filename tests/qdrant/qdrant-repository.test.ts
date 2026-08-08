import { describe, it, expect, vi } from 'vitest';
import { upsertChunks, deleteProjectVectors } from '../../src/qdrant/qdrant-repository';
import type { DocumentPoint } from '../../src/qdrant/qdrant-repository';

describe('upsertChunks', () => {
  it('upserts points with id/vector/payload', async () => {
    const client = { upsert: vi.fn().mockResolvedValue(true) } as any;
    const points: DocumentPoint[] = [
      {
        id: 'a',
        vector: [1, 2],
        payload: {
          project: 'p',
          file: 'f.md',
          absolute_path: '/repo/f.md',
          document_type: 'markdown',
          category: 'features',
          content_hash: 'h',
          git_commit: 'c',
          chunk_index: 0,
          title: 't',
          section: 's',
          content: 'x',
        },
      },
    ];

    await upsertChunks(client, 'docs', points);

    expect(client.upsert).toHaveBeenCalledWith('docs', {
      points: [{ id: 'a', vector: [1, 2], payload: points[0].payload }],
    });
  });

  it('does nothing for an empty points array', async () => {
    const client = { upsert: vi.fn() } as any;
    await upsertChunks(client, 'docs', []);
    expect(client.upsert).not.toHaveBeenCalled();
  });
});

describe('deleteProjectVectors', () => {
  it('deletes points filtered by project', async () => {
    const client = { delete: vi.fn().mockResolvedValue(true) } as any;
    await deleteProjectVectors(client, 'docs', 'bidubadu');
    expect(client.delete).toHaveBeenCalledWith('docs', {
      filter: { must: [{ key: 'project', match: { value: 'bidubadu' } }] },
    });
  });
});
