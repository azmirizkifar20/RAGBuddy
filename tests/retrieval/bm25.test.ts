import { describe, it, expect } from 'vitest';
import { tokenize, buildBm25Index, bm25Search } from '../../src/retrieval/bm25';

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric characters', () => {
    expect(tokenize('Hello, World! Sync-Hook_v2')).toEqual(['hello', 'world', 'sync', 'hook_v2']);
  });

  it('returns an empty array for text with no word characters', () => {
    expect(tokenize('--- *** ...')).toEqual([]);
  });
});

describe('buildBm25Index', () => {
  it('builds document frequency counts and average doc length from the chunk corpus', () => {
    const index = buildBm25Index([
      { file: 'a.md', section: 'Intro', content: 'sync commit hook' },
      { file: 'b.md', section: 'Setup', content: 'sync install' },
    ]);

    expect(index.n).toBe(2);
    expect(index.df.get('sync')).toBe(2);
    expect(index.df.get('commit')).toBe(1);
    expect(index.avgDocLen).toBe(2.5);
  });

  it('produces a zero-length empty index for an empty corpus', () => {
    const index = buildBm25Index([]);
    expect(index.n).toBe(0);
    expect(index.avgDocLen).toBe(0);
  });
});

describe('bm25Search', () => {
  const index = buildBm25Index([
    { file: 'a.md', section: 'Hook', content: 'the ELECTRON_RUN_AS_NODE env var forces headless node' },
    { file: 'b.md', section: 'Setup', content: 'install ollama and pull the embedding model' },
    { file: 'c.md', section: 'Sync', content: 'sync runs after every commit via the git hook' },
  ]);

  it('finds the chunk containing an exact rare term that a paraphrase would likely miss', () => {
    const results = bm25Search(index, 'ELECTRON_RUN_AS_NODE', 5);
    expect(results[0].file).toBe('a.md');
    expect(results[0].score).toBe(1);
  });

  it('returns an empty array when no corpus term matches the query', () => {
    expect(bm25Search(index, 'completely unrelated gibberish zzz', 5)).toEqual([]);
  });

  it('returns an empty array for an empty index', () => {
    const empty = buildBm25Index([]);
    expect(bm25Search(empty, 'sync', 5)).toEqual([]);
  });

  it('respects the limit', () => {
    const results = bm25Search(index, 'the', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('normalizes scores 0-1 against the top hit in the batch', () => {
    const results = bm25Search(index, 'sync hook', 5);
    expect(results[0].score).toBe(1);
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
