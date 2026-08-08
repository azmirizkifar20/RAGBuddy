import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../src/ingestion/parser';

describe('parseMarkdown', () => {
  it('splits content into sections at each heading and tracks the document title', () => {
    const md = '# Title\n\nIntro para.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.\n';
    const sections = parseMarkdown(md);

    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({ title: 'Title', heading: 'Title', level: 1 });
    expect(sections[0].content).toContain('Intro para.');
    expect(sections[1]).toMatchObject({ title: 'Title', heading: 'Section A', level: 2 });
    expect(sections[1].content).toContain('Content A.');
    expect(sections[2]).toMatchObject({ title: 'Title', heading: 'Section B', level: 2 });
    expect(sections[2].content).toContain('Content B.');
  });

  it('keeps content before the first heading as its own section', () => {
    const md = 'Preamble text.\n\n# Title\n\nBody.\n';
    const sections = parseMarkdown(md);

    expect(sections[0]).toMatchObject({ title: '', heading: '', level: 0 });
    expect(sections[0].content).toContain('Preamble text.');
    expect(sections[1]).toMatchObject({ title: 'Title', heading: 'Title', level: 1 });
  });

  it('returns no sections for empty content', () => {
    expect(parseMarkdown('')).toHaveLength(0);
  });

  it('does not treat # comments inside fenced code blocks as headings', () => {
    const md = [
      '# Title',
      '',
      '## Section A',
      '',
      '```bash',
      '# this is a shell comment, not a heading',
      '## so is this',
      'echo hello',
      '```',
      '',
      '## Section B',
      '',
      'Content B.',
      '',
    ].join('\n');
    const sections = parseMarkdown(md);

    expect(sections).toHaveLength(3);
    expect(sections[0]).toMatchObject({ heading: 'Title', level: 1 });
    expect(sections[1]).toMatchObject({ heading: 'Section A', level: 2 });
    expect(sections[1].content).toContain('# this is a shell comment, not a heading');
    expect(sections[1].content).toContain('## so is this');
    expect(sections[1].content).toContain('echo hello');
    expect(sections[2]).toMatchObject({ heading: 'Section B', level: 2 });
    expect(sections[2].content).toContain('Content B.');
  });
});
