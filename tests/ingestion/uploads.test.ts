import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
    getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
    // No `size` — these tests don't exercise the dimension guard, so ensureCollection's
    // mismatch check is a no-op here (matches the real code's `existingSize !== undefined` guard).
    getCollection: vi.fn().mockResolvedValue({ config: { params: { vectors: {} } } }),
    createCollection: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    upsert: vi.fn().mockResolvedValue(true),
  } as any;
}

describe('assertSafeUploadName', () => {
  it('accepts a plain supported filename and trims surrounding whitespace', () => {
    expect(assertSafeUploadName(' api-notes.md ')).toBe('api-notes.md');
  });

  it.each([
    'Laporan Keuangan Q1.pdf',
    'Ringkasan Proyék.docx',
    'Laporan – Q1.pdf',
    'data, final.xlsx',
    'notes & ideas.md',
    '報告書.pdf',
    'spec_v2+final.md',
    'harga 100% naik.txt',
    'file#1.md',
    "client's brief.docx",
  ])('accepts the ordinary real-world filename %s', (name) => {
    expect(assertSafeUploadName(name)).toBe(name);
  });

  it.each([
    '../../../etc/passwd',
    '../secret.md',
    'nested/file.md',
    'nested\\file.md',
    'a..b.md',
    '.env',
    '.hidden.md',
  ])('rejects the traversal or hidden path %s', (name) => {
    expect(() => assertSafeUploadName(name)).toThrow();
  });

  it.each(['star*.md', 'q?.md', 'pipe|.md', 'lt<gt>.md', 'quote".md', 'C:evil.md'])(
    'rejects the Windows-illegal name %s',
    (name) => {
      expect(() => assertSafeUploadName(name)).toThrow();
    },
  );

  it('rejects control characters, which no file picker produces but an API caller can', () => {
    expect(() => assertSafeUploadName(`a\u0000b.md`)).toThrow();
    expect(() => assertSafeUploadName(`bell\u0007.md`)).toThrow();
    expect(() => assertSafeUploadName(`del\u007f.md`)).toThrow();
  });

  it.each(['CON.md', 'nul.txt', 'COM1.md', 'lpt9.pdf'])(
    'rejects the reserved Windows device name %s',
    (name) => {
      expect(() => assertSafeUploadName(name)).toThrow('reserved device name');
    },
  );

  it('rejects a trailing dot or space, which Windows would silently strip into a name collision', () => {
    expect(() => assertSafeUploadName('report.md.')).toThrow('must not end with a dot or space');
    // A space *inside* the name is fine — only a trailing one is a problem, and
    // trim() has already removed it by this point.
    expect(assertSafeUploadName('quarterly report .md ')).toBe('quarterly report .md');
  });

  it('rejects an over-long filename', () => {
    expect(() => assertSafeUploadName(`${'x'.repeat(250)}.md`)).toThrow('too long');
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
    dataDir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-uploads-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function deps(qdrantClient: any) {
    return {
      qdrantClient,
      qdrantUrl: 'http://localhost:6333',
      qdrantCollection: 'ragbuddy_documents',
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

  it('reports extract/chunk/embed/save stages via onLog and onProgress', async () => {
    const qdrantClient = qdrantStub();
    const onLog = vi.fn();
    const onProgress = vi.fn();
    const embeddingProvider = {
      embedDocuments: vi.fn((texts: string[], progress?: (done: number, total: number) => void) => {
        texts.forEach((_, i) => progress?.(i + 1, texts.length));
        return Promise.resolve(texts.map(() => [0.1, 0.2]));
      }),
      embedQuery: vi.fn(),
    };

    await uploadDocument(
      project,
      { filename: 'notes.md', content: '# Notes\n\nSome content.\n' },
      { ...deps(qdrantClient), embeddingProvider: embeddingProvider as any, onLog, onProgress },
    );

    const messages = onLog.mock.calls.map((call) => call[0]);
    expect(messages).toEqual([
      'Extracting text from notes.md',
      'Chunked notes.md into 1 piece(s)',
      'Embedding uploads/notes.md (1 chunk(s))',
      'Embedded 1/1 chunk(s) of notes.md',
      'Saving 1 chunk(s) to the index',
      'Upserted 1 chunk(s) for uploads/notes.md',
    ]);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  it('replaces the previous vectors when the same filename is uploaded again', async () => {
    const qdrantClient = qdrantStub();
    await uploadDocument(project, { filename: 'notes.md', content: '# One\n' }, deps(qdrantClient));
    qdrantClient.delete.mockClear();

    const result = await uploadDocument(project, { filename: 'notes.md', content: '# Two\n' }, deps(qdrantClient));

    expect(result.replaced).toBe(true);
    expect(qdrantClient.delete).toHaveBeenCalledWith('ragbuddy_documents', {
      wait: true,
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

  it('refreshes cached dashboard stats when a statsStore is provided', async () => {
    const qdrantClient = { ...qdrantStub(), scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }) };
    const statsStore = { get: vi.fn(), set: vi.fn(), remove: vi.fn() } as any;

    await uploadDocument(
      project,
      { filename: 'notes.md', content: '# Notes\n' },
      { ...deps(qdrantClient), statsStore },
    );

    expect(statsStore.set).toHaveBeenCalledTimes(1);
    expect(statsStore.set.mock.calls[0][0]).toBe('sample');
  });

  it('does not touch a statsStore that was never provided', async () => {
    await expect(
      uploadDocument(project, { filename: 'notes.md', content: '# Notes\n' }, deps(qdrantStub())),
    ).resolves.toBeDefined();
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
    dataDir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-uploads-list-'));
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
        qdrantCollection: 'ragbuddy_documents',
        embeddingProvider: { embedDocuments: vi.fn().mockResolvedValue([[0.1]]), embedQuery: vi.fn() } as any,
        dataDir,
      },
    );

    expect(listUploads(dataDir, 'sample')).toEqual([
      expect.objectContaining({ file: 'uploads/notes.md', name: 'notes.md' }),
    ]);

    await removeUpload(project, 'notes.md', {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      dataDir,
    });

    expect(listUploads(dataDir, 'sample')).toEqual([]);
    expect(existsSync(path.join(uploadsDirFor(dataDir, 'sample'), 'notes.md'))).toBe(false);
  });

  it('refreshes cached dashboard stats after removing an upload, when a statsStore is provided', async () => {
    const qdrantClient = { ...qdrantStub(), scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }) };
    await uploadDocument(
      project,
      { filename: 'notes.md', content: '# Notes\n' },
      {
        qdrantClient,
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'ragbuddy_documents',
        embeddingProvider: { embedDocuments: vi.fn().mockResolvedValue([[0.1]]), embedQuery: vi.fn() } as any,
        dataDir,
      },
    );

    const statsStore = { get: vi.fn(), set: vi.fn(), remove: vi.fn() } as any;
    await removeUpload(project, 'notes.md', {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      dataDir,
      statsStore,
    });

    expect(statsStore.set).toHaveBeenCalledTimes(1);
    expect(statsStore.set.mock.calls[0][0]).toBe('sample');
  });

  it('actually deletes a file whose name contains non-ASCII characters', async () => {
    // Regression: fs.rmSync on Windows returns success without deleting when
    // the filename has non-ASCII characters, so removeUpload must use unlink.
    const name = 'Ringkasan Proyék – Q1.md';
    const qdrantClient = qdrantStub();
    await uploadDocument(
      project,
      { filename: name, content: '# Ringkasan\n\nIsi dokumen.\n' },
      {
        qdrantClient,
        qdrantUrl: 'http://localhost:6333',
        qdrantCollection: 'ragbuddy_documents',
        embeddingProvider: {
          embedDocuments: vi.fn((texts: string[]) => Promise.resolve(texts.map(() => [0.1]))),
          embedQuery: vi.fn(),
        } as any,
        dataDir,
      },
    );
    expect(existsSync(path.join(uploadsDirFor(dataDir, 'sample'), name))).toBe(true);

    await removeUpload(project, name, {
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      dataDir,
    });

    expect(existsSync(path.join(uploadsDirFor(dataDir, 'sample'), name))).toBe(false);
    expect(listUploads(dataDir, 'sample')).toEqual([]);
  });

  it('removes the file without erroring when the Qdrant collection is missing (e.g. dropped since upload)', async () => {
    const dir = uploadsDirFor(dataDir, 'sample');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'notes.md'), '# Notes\n');
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      delete: vi.fn().mockRejectedValue(new Error('Not Found')),
    };

    await removeUpload(project, 'notes.md', {
      qdrantClient: qdrantClient as any,
      qdrantCollection: 'ragbuddy_documents',
      dataDir,
    });

    expect(qdrantClient.delete).not.toHaveBeenCalled();
    expect(existsSync(path.join(dir, 'notes.md'))).toBe(false);
  });

  it('throws for a document that was never uploaded', async () => {
    await expect(
      removeUpload(project, 'missing.md', {
        qdrantClient: qdrantStub(),
        qdrantCollection: 'ragbuddy_documents',
        dataDir,
      }),
    ).rejects.toThrow('does not exist');
  });
});
