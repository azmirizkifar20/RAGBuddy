import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertSafeUploadName,
  uploadDocument,
  listUploads,
  removeUpload,
  uploadsDirFor,
} from '../../src/ingestion/uploads';

const project = { id: 'sample', name: 'Sample', repository: '/repo', paths: ['docs'] };

function qdrantStub() {
  return {
    getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'project_rag_documents' }] }),
    createCollection: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    upsert: vi.fn().mockResolvedValue(true),
  } as any;
}

describe('assertSafeUploadName', () => {
  it('accepts a plain supported filename', () => {
    expect(assertSafeUploadName(' api-notes.md ')).toBe('api-notes.md');
  });

  it.each([
    '../../../etc/passwd',
    '../secret.md',
    'nested/file.md',
    'nested\\file.md',
    '.env',
    '.hidden.md',
  ])('rejects the traversal or hidden path %s', (name) => {
    expect(() => assertSafeUploadName(name)).toThrow();
  });

  it('rejects an unsupported extension', () => {
    expect(() => assertSafeUploadName('payload.exe')).toThrow('Unsupported file type');
  });

  it('rejects an empty name', () => {
    expect(() => assertSafeUploadName('   ')).toThrow('Filename is required');
  });
});

describe('uploadDocument', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'project-rag-uploads-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function deps(qdrantClient: any) {
    return {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'project_rag_documents',
      embeddingProvider: {
        // One vector per chunk, like a real provider — a fixed-length mock
        // would hand undefined vectors to every chunk past the first.
        embedDocuments: vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [0.1, 0.2]))),
        embedQuery: vi.fn(),
      } as any,
      dataDir,
    };
  }

  it('stores the file outside the repository and upserts upload-tagged chunks', async () => {
    const qdrantClient = qdrantStub();

    const result = await uploadDocument(
      project,
      { filename: 'notes.md', content: '# Notes\n\nSome content.\n' },
      deps(qdrantClient),
    );

    expect(result).toMatchObject({ file: 'uploads/notes.md', name: 'notes.md', replaced: false });
    const stored = path.join(uploadsDirFor(dataDir, 'sample'), 'notes.md');
    expect(existsSync(stored)).toBe(true);
    expect(readFileSync(stored, 'utf8')).toContain('Some content.');

    const payload = qdrantClient.upsert.mock.calls[0][1].points[0].payload;
    expect(payload).toMatchObject({
      project: 'sample',
      file: 'uploads/notes.md',
      source: 'upload',
      category: 'upload',
      git_commit: null,
    });
    // Nothing was written into the user's repository path.
    expect(payload.absolute_path.startsWith(dataDir)).toBe(true);
  });

  it('replaces the previous vectors when the same filename is uploaded again', async () => {
    const qdrantClient = qdrantStub();
    await uploadDocument(project, { filename: 'notes.md', content: '# One\n' }, deps(qdrantClient));
    qdrantClient.delete.mockClear();

    const result = await uploadDocument(project, { filename: 'notes.md', content: '# Two\n' }, deps(qdrantClient));

    expect(result.replaced).toBe(true);
    expect(qdrantClient.delete).toHaveBeenCalledWith('project_rag_documents', {
      filter: {
        must: [
          { key: 'project', match: { value: 'sample' } },
          { key: 'file', match: { value: 'uploads/notes.md' } },
        ],
      },
    });
  });

  it('rejects a traversal filename before touching Qdrant or the disk', async () => {
    const qdrantClient = qdrantStub();

    await expect(
      uploadDocument(project, { filename: '../../escape.md', content: '# Hi\n' }, deps(qdrantClient)),
    ).rejects.toThrow();

    expect(qdrantClient.upsert).not.toHaveBeenCalled();
    expect(existsSync(uploadsDirFor(dataDir, 'sample'))).toBe(false);
  });

  it('rejects a document with no extractable text', async () => {
    await expect(
      uploadDocument(project, { filename: 'blank.md', content: '   \n' }, deps(qdrantStub())),
    ).rejects.toThrow('No text could be extracted');
  });

  it('rejects a zero-byte upload', async () => {
    await expect(
      uploadDocument(project, { filename: 'blank.md', data: Buffer.alloc(0) }, deps(qdrantStub())),
    ).rejects.toThrow('Uploaded document is empty');
  });

  it('stores a binary upload byte-for-byte while indexing its extracted text', async () => {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Q1');
    sheet.addRow(['Region', 'Amount']);
    sheet.addRow(['Medan', 7300]);
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());

    const qdrantClient = qdrantStub();
    const result = await uploadDocument(
      project,
      { filename: 'quarterly.xlsx', data: xlsx },
      deps(qdrantClient),
    );

    expect(result).toMatchObject({ file: 'uploads/quarterly.xlsx', documentType: 'xlsx', truncated: false });

    // The original workbook is on disk unchanged — not the extracted text.
    const stored = readFileSync(path.join(uploadsDirFor(dataDir, 'sample'), 'quarterly.xlsx'));
    expect(stored.equals(xlsx)).toBe(true);

    // What got indexed is readable text, not zip bytes, and every chunk got a
    // real vector rather than the first one only.
    const points = qdrantClient.upsert.mock.calls[0][1].points;
    expect(points.every((p: any) => Array.isArray(p.vector))).toBe(true);
    expect(points[0].payload.document_type).toBe('xlsx');
    const allContent = points.map((p: any) => p.payload.content).join('\n');
    expect(allContent).toContain('## Q1');
    expect(allContent).toContain('| Medan | 7300 |');
    expect(allContent).not.toContain('PK');
  });

  it('refuses a PDF with no text layer instead of indexing an empty document', async () => {
    // Valid PDF structure, but no content stream to extract text from.
    const emptyPdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Size 3 /Root 1 0 R >>\n%%EOF\n',
      'latin1',
    );

    await expect(
      uploadDocument(project, { filename: 'scan.pdf', data: emptyPdf }, deps(qdrantStub())),
    ).rejects.toThrow();
    expect(existsSync(path.join(uploadsDirFor(dataDir, 'sample'), 'scan.pdf'))).toBe(false);
  });

  it('writes nothing to disk when embedding fails', async () => {
    const failing = {
      ...deps(qdrantStub()),
      embeddingProvider: {
        embedDocuments: vi.fn().mockRejectedValue(new Error('provider down')),
        embedQuery: vi.fn(),
      } as any,
    };

    await expect(uploadDocument(project, { filename: 'notes.md', content: '# Hi\n' }, failing)).rejects.toThrow(
      'provider down',
    );
    expect(existsSync(path.join(uploadsDirFor(dataDir, 'sample'), 'notes.md'))).toBe(false);
  });
});

describe('listUploads / removeUpload', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'project-rag-uploads-list-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns an empty list for a project that never uploaded anything', () => {
    expect(listUploads(dataDir, 'sample')).toEqual([]);
  });

  it('lists uploads and removes both the file and its vectors', async () => {
    const qdrantClient = qdrantStub();
    await uploadDocument(
      project,
      { filename: 'notes.md', content: '# Notes\n' },
      {
        qdrantClient,
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'project_rag_documents',
        embeddingProvider: { embedDocuments: vi.fn().mockResolvedValue([[0.1]]), embedQuery: vi.fn() } as any,
        dataDir,
      },
    );

    expect(listUploads(dataDir, 'sample')).toEqual([
      expect.objectContaining({ file: 'uploads/notes.md', name: 'notes.md' }),
    ]);

    await removeUpload(project, 'notes.md', {
      qdrantClient,
      qdrantCollection: 'project_rag_documents',
      dataDir,
    });

    expect(listUploads(dataDir, 'sample')).toEqual([]);
    expect(existsSync(path.join(uploadsDirFor(dataDir, 'sample'), 'notes.md'))).toBe(false);
  });

  it('throws for a document that was never uploaded', async () => {
    await expect(
      removeUpload(project, 'missing.md', {
        qdrantClient: qdrantStub(),
        qdrantCollection: 'project_rag_documents',
        dataDir,
      }),
    ).rejects.toThrow('does not exist');
  });
});
