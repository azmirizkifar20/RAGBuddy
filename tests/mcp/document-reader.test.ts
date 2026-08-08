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

  it('reads a document inside the configured paths', async () => {
    const content = await getProjectDocument(project(), 'docs/steering/architecture.md');
    expect(content).toContain('# Architecture');
  });

  it('rejects a path that escapes the repository root', async () => {
    await expect(getProjectDocument(project(), '../../etc/passwd')).rejects.toThrow('escapes repository root');
  });

  it('rejects a file that exists in the repo but outside the configured paths', async () => {
    await expect(getProjectDocument(project(), 'secret.txt')).rejects.toThrow(
      "outside the project's configured documentation paths",
    );
  });

  it('rejects a nonexistent file within the configured paths', async () => {
    await expect(getProjectDocument(project(), 'docs/steering/does-not-exist.md')).rejects.toThrow('File not found');
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

    it('reads an uploaded document from the data directory', async () => {
      const content = await getProjectDocument(project(), 'uploads/notes.md', { dataDir });
      expect(content).toContain('From the dashboard.');
    });

    it('rejects traversal out of the uploads directory', async () => {
      await expect(getProjectDocument(project(), 'uploads/../private.md', { dataDir })).rejects.toThrow();
      await expect(getProjectDocument(project(), 'uploads/../../../../etc/passwd', { dataDir })).rejects.toThrow();
    });

    it('reports a missing upload rather than falling back to the repository', async () => {
      await expect(getProjectDocument(project(), 'uploads/missing.md', { dataDir })).rejects.toThrow('File not found');
    });

    it('explains itself when no data directory is configured', async () => {
      await expect(getProjectDocument(project(), 'uploads/notes.md')).rejects.toThrow('no data directory configured');
    });

    it('converts a stored binary upload to text instead of returning raw bytes', async () => {
      // A real .xlsx written to the uploads dir, exactly as an upload leaves it.
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Totals');
      sheet.addRow(['Region', 'Amount']);
      sheet.addRow(['Surabaya', 4200]);
      writeFileSync(
        path.join(dataDir, 'uploads', 'sample', 'totals.xlsx'),
        Buffer.from(await workbook.xlsx.writeBuffer()),
      );

      const content = await getProjectDocument(project(), 'uploads/totals.xlsx', { dataDir });

      expect(content).toContain('## Totals');
      expect(content).toContain('| Surabaya | 4200 |');
      expect(content).not.toContain('PK'); // not the raw zip container
    });
  });
});
