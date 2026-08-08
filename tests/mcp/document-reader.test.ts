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

  describe('uploaded documents', () => {
    let dataDir: string;

    beforeEach(() => {
      dataDir = mkdtempSync(path.join(tmpdir(), 'project-rag-docreader-data-'));
      mkdirSync(path.join(dataDir, 'uploads', 'sample'), { recursive: true });
      writeFileSync(path.join(dataDir, 'uploads', 'sample', 'notes.md'), '# Uploaded\n\nFrom the dashboard.\n');
      writeFileSync(path.join(dataDir, 'private.md'), 'not an upload');
    });

    afterEach(() => {
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('reads an uploaded document from the data directory', () => {
      const content = getProjectDocument(project(), 'uploads/notes.md', { dataDir });
      expect(content).toContain('From the dashboard.');
    });

    it('rejects traversal out of the uploads directory', () => {
      expect(() => getProjectDocument(project(), 'uploads/../private.md', { dataDir })).toThrow();
      expect(() => getProjectDocument(project(), 'uploads/../../../../etc/passwd', { dataDir })).toThrow();
    });

    it('reports a missing upload rather than falling back to the repository', () => {
      expect(() => getProjectDocument(project(), 'uploads/missing.md', { dataDir })).toThrow('File not found');
    });

    it('explains itself when no data directory is configured', () => {
      expect(() => getProjectDocument(project(), 'uploads/notes.md')).toThrow('no data directory configured');
    });
  });
});
