import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChatFeedbackStore } from '../../src/history/chat-feedback';

describe('ChatFeedbackStore', () => {
  let dir: string;
  let store: ChatFeedbackStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-feedback-'));
    store = new ChatFeedbackStore(path.join(dir, 'nested', 'chat-feedback.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function record(project: string, rating: 'up' | 'down' = 'up') {
    return { project, query: 'how does sync work?', answer: 'it runs on commit', rating, sources: [] };
  }

  it('returns an empty list when no feedback file exists yet', () => {
    expect(store.list()).toEqual([]);
  });

  it('creates the parent directory, stamps id/createdAt, and returns records newest first', () => {
    const first = store.append(record('a'));
    const second = store.append(record('b'));

    expect(first.id).toBeTruthy();
    expect(first.createdAt).toBeTruthy();
    expect(store.list().map((r) => r.project)).toEqual(['b', 'a']);
    expect(second.id).not.toBe(first.id);
  });

  it('filters by project and honours the limit', () => {
    store.append(record('a'));
    store.append(record('b'));
    store.append(record('a'));

    expect(store.list({ project: 'a' })).toHaveLength(2);
    expect(store.list({ limit: 1 }).map((r) => r.project)).toEqual(['a']);
  });

  it('treats a corrupt feedback file as empty rather than throwing', () => {
    const filePath = path.join(dir, 'corrupt.json');
    writeFileSync(filePath, 'not json at all', 'utf8');

    expect(new ChatFeedbackStore(filePath).list()).toEqual([]);
  });

  it('preserves the rating and sources exactly as given', () => {
    store.append({
      project: 'a',
      query: 'q',
      answer: 'a',
      rating: 'down',
      sources: [{ file: 'docs/x.md', section: 'S', score: 0.5 }],
    });

    expect(store.list()[0]).toMatchObject({
      rating: 'down',
      sources: [{ file: 'docs/x.md', section: 'S', score: 0.5 }],
    });
  });
});
