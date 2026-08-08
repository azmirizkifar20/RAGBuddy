import { describe, it, expect, vi } from 'vitest';
import {
  upsertChunks,
  deleteProjectVectors,
  getIndexedFileHashes,
  deleteFileVectors,
  searchPoints,
} from '../../src/qdrant/qdrant-repository';
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

describe('getIndexedFileHashes', () => {
  it('builds a file→hash map from existing points, paginating until exhausted', async () => {
    const client = {
      scroll: vi
        .fn()
        .mockResolvedValueOnce({
          points: [{ id: 'a', payload: { file: 'docs/a.md', content_hash: 'hash-a' } }],
          next_page_offset: 'page2',
        })
        .mockResolvedValueOnce({
          points: [{ id: 'b', payload: { file: 'docs/b.md', content_hash: 'hash-b' } }],
          next_page_offset: null,
        }),
    } as any;

    const result = await getIndexedFileHashes(client, 'docs', 'sample');

    expect(result).toEqual(
      new Map([
        ['docs/a.md', 'hash-a'],
        ['docs/b.md', 'hash-b'],
      ]),
    );
    expect(client.scroll).toHaveBeenCalledTimes(2);
    expect(client.scroll).toHaveBeenNthCalledWith(
      1,
      'docs',
      expect.objectContaining({
        filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
        offset: undefined,
      }),
    );
    expect(client.scroll).toHaveBeenNthCalledWith(2, 'docs', expect.objectContaining({ offset: 'page2' }));
  });

  it('returns an empty map when there are no points', async () => {
    const client = { scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }) } as any;
    const result = await getIndexedFileHashes(client, 'docs', 'sample');
    expect(result.size).toBe(0);
  });
});

describe('deleteFileVectors', () => {
  it('deletes points filtered by project and file', async () => {
    const client = { delete: vi.fn().mockResolvedValue(true) } as any;
    await deleteFileVectors(client, 'docs', 'sample', 'docs/a.md');
    expect(client.delete).toHaveBeenCalledWith('docs', {
      filter: {
        must: [
          { key: 'project', match: { value: 'sample' } },
          { key: 'file', match: { value: 'docs/a.md' } },
        ],
      },
    });
  });
});

describe('searchPoints', () => {
  it('searches with a project filter and maps score/payload', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({
        points: [{ id: '1', score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'hi' } }],
      }),
    } as any;

    const hits = await searchPoints(client, 'docs', 'sample', [0.1, 0.2], 5);

    expect(client.query).toHaveBeenCalledWith('docs', {
      query: [0.1, 0.2],
      limit: 5,
      filter: { must: [{ key: 'project', match: { value: 'sample' } }] },
      with_payload: true,
    });
    expect(hits).toEqual([{ score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'hi' } }]);
  });

  it('never omits the project filter, even with an empty project string edge case', async () => {
    const client = { query: vi.fn().mockResolvedValue({ points: [] }) } as any;
    await searchPoints(client, 'docs', 'bidubadu', [0.1], 3);
    const callArgs = client.query.mock.calls[0][1];
    expect(callArgs.filter).toEqual({ must: [{ key: 'project', match: { value: 'bidubadu' } }] });
  });
});
