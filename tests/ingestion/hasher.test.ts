import { describe, it, expect } from 'vitest';
import { hashContent } from '../../src/ingestion/hasher';

describe('hashContent', () => {
  it('produces the same hash for unchanged content', () => {
    expect(hashContent('hello world')).toBe(hashContent('hello world'));
  });

  it('produces a different hash for modified content', () => {
    expect(hashContent('hello world')).not.toBe(hashContent('hello world!'));
  });

  it('produces a 64-character hex SHA-256 digest', () => {
    expect(hashContent('hello world')).toMatch(/^[0-9a-f]{64}$/);
  });
});
