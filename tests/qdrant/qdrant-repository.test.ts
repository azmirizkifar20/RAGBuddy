import { describe, it, expect, vi } from 'vitest';
import {
  upsertChunks,
  deleteProjectVectors,
  getIndexedFileHashes,
  getIndexedFiles,
  computeProjectDataStats,
  deleteFileVectors,
  searchPoints,
  getProjectChunks,
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
      wait: true,
      points: [{ id: 'a', vector: [1, 2], payload: points[0].payload }],
    });
  });

  it('waits for the write to be applied, so an immediate search can see it', async () => {
    const client = { upsert: vi.fn().mockResolvedValue(true) } as any;
    await upsertChunks(client, 'docs', [
      { id: 'a', vector: [1], payload: { project: 'p' } as any },
    ]);
    expect(client.upsert.mock.calls[0][1].wait).toBe(true);
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
      wait: true,
      filter: { must: [{ key: 'project', match: { value: 'bidubadu' } }] },
    });
  });
});

describe('getIndexedFileHashes', () => {
  it('builds a file→hash map from existing points, paginating until exhausted', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
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
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    } as any;
    const result = await getIndexedFileHashes(client, 'docs', 'sample');
    expect(result.size).toBe(0);
  });

  it('returns an empty map without calling scroll when the collection does not exist yet', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      scroll: vi.fn(),
    } as any;

    const result = await getIndexedFileHashes(client, 'docs', 'sample');

    expect(result.size).toBe(0);
    expect(client.scroll).not.toHaveBeenCalled();
  });
});

describe('source scoping', () => {
  function scrollClient(points: unknown[]) {
    return {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({ points, next_page_offset: null }),
    } as any;
  }

  it('excludes uploads from the repository scope via must_not, so legacy points still match', async () => {
    const client = scrollClient([]);

    await getIndexedFileHashes(client, 'docs', 'sample', 'repository');

    expect(client.scroll.mock.calls[0][1].filter).toEqual({
      must: [{ key: 'project', match: { value: 'sample' } }],
      must_not: [{ key: 'source', match: { value: 'upload' } }],
    });
  });

  it('matches only uploads in the upload scope', async () => {
    const client = scrollClient([]);

    await getIndexedFileHashes(client, 'docs', 'sample', 'upload');

    expect(client.scroll.mock.calls[0][1].filter).toEqual({
      must: [
        { key: 'project', match: { value: 'sample' } },
        { key: 'source', match: { value: 'upload' } },
      ],
    });
  });

  it('scopes deleteProjectVectors the same way, so a re-index never wipes uploads', async () => {
    const client = { delete: vi.fn().mockResolvedValue(true) } as any;

    await deleteProjectVectors(client, 'docs', 'sample', 'repository');

    expect(client.delete).toHaveBeenCalledWith('docs', {
      wait: true,
      filter: {
        must: [{ key: 'project', match: { value: 'sample' } }],
        must_not: [{ key: 'source', match: { value: 'upload' } }],
      },
    });
  });
});

describe('getIndexedFiles', () => {
  it('groups chunks per file, sorts by path, and defaults a missing source to repository', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/b.md', title: 'B' } },
          { id: '2', payload: { file: 'docs/a.md', title: 'A' } },
          { id: '3', payload: { file: 'docs/a.md', title: 'A' } },
          { id: '4', payload: { file: 'uploads/n.md', title: 'N', source: 'upload' } },
        ],
        next_page_offset: null,
      }),
    } as any;

    expect(await getIndexedFiles(client, 'docs', 'sample')).toEqual([
      { file: 'docs/a.md', source: 'repository', documentType: 'markdown', chunkCount: 2, title: 'A' },
      { file: 'docs/b.md', source: 'repository', documentType: 'markdown', chunkCount: 1, title: 'B' },
      { file: 'uploads/n.md', source: 'upload', documentType: 'markdown', chunkCount: 1, title: 'N' },
    ]);
  });

  it('returns an empty list without scrolling when the collection does not exist yet', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      scroll: vi.fn(),
    } as any;

    expect(await getIndexedFiles(client, 'docs', 'sample')).toEqual([]);
    expect(client.scroll).not.toHaveBeenCalled();
  });
});

describe('computeProjectDataStats', () => {
  it('aggregates file/chunk/upload counts from the same source as getIndexedFiles', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/a.md' } },
          { id: '2', payload: { file: 'docs/a.md' } },
          { id: '3', payload: { file: 'docs/b.md' } },
          { id: '4', payload: { file: 'uploads/n.md', source: 'upload' } },
        ],
        next_page_offset: null,
      }),
    } as any;

    expect(await computeProjectDataStats(client, 'docs', 'sample')).toEqual({
      indexedFileCount: 3,
      chunkCount: 4,
      uploadCount: 1,
    });
  });

  it('returns all zeros when the collection does not exist yet', async () => {
    const client = { getCollections: vi.fn().mockResolvedValue({ collections: [] }), scroll: vi.fn() } as any;

    expect(await computeProjectDataStats(client, 'docs', 'sample')).toEqual({
      indexedFileCount: 0,
      chunkCount: 0,
      uploadCount: 0,
    });
    expect(client.scroll).not.toHaveBeenCalled();
  });
});

describe('deleteFileVectors', () => {
  it('deletes points filtered by project and file', async () => {
    const client = { delete: vi.fn().mockResolvedValue(true) } as any;
    await deleteFileVectors(client, 'docs', 'sample', 'docs/a.md');
    expect(client.delete).toHaveBeenCalledWith('docs', {
      wait: true,
      filter: {
        must: [
          { key: 'project', match: { value: 'sample' } },
          { key: 'file', match: { value: 'docs/a.md' } },
        ],
      },
    });
  });
});

describe('getProjectChunks', () => {
  it('returns file/section/content for every chunk with a scope of all sources', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/a.md', section: 'Intro', content: 'hello' } },
          { id: '2', payload: { file: 'uploads/n.md', section: '', content: 'world', source: 'upload' } },
        ],
        next_page_offset: null,
      }),
    } as any;

    const chunks = await getProjectChunks(client, 'docs', 'sample');

    expect(chunks).toEqual([
      { file: 'docs/a.md', section: 'Intro', content: 'hello' },
      { file: 'uploads/n.md', section: '', content: 'world' },
    ]);
    expect(client.scroll.mock.calls[0][1].filter).toEqual({ must: [{ key: 'project', match: { value: 'sample' } }] });
  });

  it('skips a point missing file or content', async () => {
    const client = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'docs' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [{ id: '1', payload: { section: 'Intro' } }],
        next_page_offset: null,
      }),
    } as any;

    expect(await getProjectChunks(client, 'docs', 'sample')).toEqual([]);
  });

  it('returns an empty array without scrolling when the collection does not exist yet', async () => {
    const client = { getCollections: vi.fn().mockResolvedValue({ collections: [] }), scroll: vi.fn() } as any;

    expect(await getProjectChunks(client, 'docs', 'sample')).toEqual([]);
    expect(client.scroll).not.toHaveBeenCalled();
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
