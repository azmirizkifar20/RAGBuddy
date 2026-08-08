import { describe, it, expect } from 'vitest';
import { deriveCategory, composeEmbedText } from '../../src/ingestion/payload-builder';

describe('deriveCategory', () => {
  it('derives the category from the matching configured path segment', () => {
    expect(deriveCategory('docs/features/01-auth.md', ['docs'])).toBe('features');
  });

  it('derives the category for a non-default configured path', () => {
    expect(deriveCategory('knowledge-base/faq/01.md', ['knowledge-base'])).toBe('faq');
  });

  it('falls back to "other" when no configured path matches', () => {
    expect(deriveCategory('README.md', ['docs'])).toBe('other');
  });

  it('falls back to "root" when the file sits directly in the configured path', () => {
    expect(deriveCategory('docs/README.md', ['docs'])).toBe('root');
  });
});

describe('composeEmbedText', () => {
  it('joins title, section, and content with newlines', () => {
    const text = composeEmbedText({ title: 'Doc', section: 'Intro', content: 'Body text.', chunkIndex: 0 });
    expect(text).toBe('Doc\nIntro\nBody text.');
  });
});
