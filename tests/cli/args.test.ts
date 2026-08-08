import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/args';

describe('parseArgs', () => {
  it('parses an ingest command with a project id', () => {
    expect(parseArgs(['ingest', 'bidubadu'])).toEqual({ command: 'ingest', projectId: 'bidubadu' });
  });

  it('returns unknown for an unrecognized command', () => {
    expect(parseArgs(['bogus'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown when ingest is missing a project id', () => {
    expect(parseArgs(['ingest'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown for empty argv', () => {
    expect(parseArgs([])).toEqual({ command: 'unknown' });
  });
});
