import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getProjectDocument } from '../../src/mcp/document-reader';

describe('getProjectDocument', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-docreader-'));
    mkdirSync(path.join(dir, 'docs', 'steering'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'steering', 'architecture.md'), '# Architecture\n\nContent.\n');
    writeFileSync(path.join(dir, 'secret.txt'), 'top secret');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const project = () => ({ id: 'sample', name: 'sample', repository: dir, paths: ['docs'] });

  it('reads a document inside the configured paths', () => {
    const content = getProjectDocument(project(), 'docs/steering/architecture.md');
    expect(content).toContain('# Architecture');
  });

  it('rejects a path that escapes the repository root', () => {
    expect(() => getProjectDocument(project(), '../../etc/passwd')).toThrow('escapes repository root');
  });

  it('rejects a file that exists in the repo but outside the configured paths', () => {
    expect(() => getProjectDocument(project(), 'secret.txt')).toThrow(
      "outside the project's configured documentation paths",
    );
  });

  it('rejects a nonexistent file within the configured paths', () => {
    expect(() => getProjectDocument(project(), 'docs/steering/does-not-exist.md')).toThrow('File not found');
  });
});
