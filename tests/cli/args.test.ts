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

  it('parses a sync command with a project id', () => {
    expect(parseArgs(['sync', 'bidubadu'])).toEqual({ command: 'sync', projectId: 'bidubadu' });
  });

  it('returns unknown when sync is missing a project id', () => {
    expect(parseArgs(['sync'])).toEqual({ command: 'unknown' });
  });

  it('parses a search command with a project id and single-word query', () => {
    expect(parseArgs(['search', 'bidubadu', 'auth'])).toEqual({
      command: 'search',
      projectId: 'bidubadu',
      query: 'auth',
    });
  });

  it('joins a multi-word query into a single string', () => {
    expect(parseArgs(['search', 'bidubadu', 'authentication', 'flow'])).toEqual({
      command: 'search',
      projectId: 'bidubadu',
      query: 'authentication flow',
    });
  });

  it('returns unknown when search is missing a query', () => {
    expect(parseArgs(['search', 'bidubadu'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown when search is missing a project id', () => {
    expect(parseArgs(['search'])).toEqual({ command: 'unknown' });
  });
});
