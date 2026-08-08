import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../../src/ingestion/chunker';

describe('chunkMarkdown', () => {
  it('preserves heading context on each chunk', () => {
    const md = '# Doc\n\n## Section A\n\nShort content.\n';
    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ title: 'Doc', section: 'Section A', chunkIndex: 1 });
  });

  it('splits long sections to respect the configured chunk size', () => {
    const body = 'a'.repeat(500);
    const md = `## Big\n\n${body}\n`;
    const chunks = chunkMarkdown(md, { chunkSize: 100, overlap: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(100);
    }
  });

  it('overlaps consecutive chunks from the same section', () => {
    const body = 'a'.repeat(500);
    const md = `## Big\n\n${body}\n`;
    const chunks = chunkMarkdown(md, { chunkSize: 100, overlap: 20 });

    expect(chunks[1].content.slice(0, 20)).toBe(chunks[0].content.slice(-20));
  });
});
