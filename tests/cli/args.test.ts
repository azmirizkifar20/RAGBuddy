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

  it('parses the mcp command with no project id needed', () => {
    expect(parseArgs(['mcp'])).toEqual({ command: 'mcp' });
  });

  it('parses a hook install command with a project id', () => {
    expect(parseArgs(['hook', 'install', 'bidubadu'])).toEqual({
      command: 'hook',
      action: 'install',
      projectId: 'bidubadu',
    });
  });

  it('parses a hook uninstall command with a project id', () => {
    expect(parseArgs(['hook', 'uninstall', 'bidubadu'])).toEqual({
      command: 'hook',
      action: 'uninstall',
      projectId: 'bidubadu',
    });
  });

  it('returns unknown for an unrecognized hook action', () => {
    expect(parseArgs(['hook', 'bogus', 'bidubadu'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown when hook install is missing a project id', () => {
    expect(parseArgs(['hook', 'install'])).toEqual({ command: 'unknown' });
  });

  it('parses project list', () => {
    expect(parseArgs(['project', 'list'])).toEqual({ command: 'project', action: 'list' });
  });

  it('parses project remove with an id', () => {
    expect(parseArgs(['project', 'remove', 'bidubadu'])).toEqual({
      command: 'project',
      action: 'remove',
      id: 'bidubadu',
    });
  });

  it('parses project register with id and repository, no flags', () => {
    expect(parseArgs(['project', 'register', 'bidubadu', '/repo'])).toEqual({
      command: 'project',
      action: 'register',
      id: 'bidubadu',
      repository: '/repo',
      name: undefined,
      paths: undefined,
    });
  });

  it('parses project register with --name and --paths flags', () => {
    expect(
      parseArgs(['project', 'register', 'bidubadu', '/repo', '--name', 'Bidubadu', '--paths', 'docs,notes']),
    ).toEqual({
      command: 'project',
      action: 'register',
      id: 'bidubadu',
      repository: '/repo',
      name: 'Bidubadu',
      paths: ['docs', 'notes'],
    });
  });

  it('returns unknown for project register missing a repository', () => {
    expect(parseArgs(['project', 'register', 'bidubadu'])).toEqual({ command: 'unknown' });
  });

  it('returns unknown for an unrecognized project action', () => {
    expect(parseArgs(['project', 'bogus'])).toEqual({ command: 'unknown' });
  });

  it('parses the web command with no port', () => {
    expect(parseArgs(['web'])).toEqual({ command: 'web', port: undefined });
  });

  it('parses the web command with an explicit port', () => {
    expect(parseArgs(['web', '--port', '5000'])).toEqual({ command: 'web', port: 5000 });
  });
});
