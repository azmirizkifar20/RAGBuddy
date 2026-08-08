import { describe, it, expect } from 'vitest';
import {
  extractDocument,
  assertSupportedUploadExtension,
  stripDataUriImages,
  SUPPORTED_UPLOAD_EXTENSIONS,
  MAX_EXTRACTED_CHARS,
} from '../../src/ingestion/document-extractor';

/** Minimal uncompressed single-page PDF carrying one line of real text. */
function buildPdf(lines: string[]): Buffer {
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${lines.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${lines.length} >>`,
  ];
  lines.forEach((line) => {
    const content = `BT /F1 12 Tf 72 720 Td (${line}) Tj ET`;
    const contentObjNumber = objects.length + 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNumber} 0 R /Resources << /Font << /F1 ${lines.length * 2 + 3} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function buildXlsx(): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Revenue');
  sheet.addRow(['Region', 'Amount', 'Signed']);
  sheet.addRow(['Jakarta', 1500, new Date(Date.UTC(2026, 0, 15))]);
  sheet.addRow([]);
  sheet.addRow(['Bandung', 900, new Date(Date.UTC(2026, 1, 2))]);
  workbook.addWorksheet('Empty');
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('assertSupportedUploadExtension', () => {
  it('maps every documented extension to a type', () => {
    for (const extension of SUPPORTED_UPLOAD_EXTENSIONS) {
      expect(assertSupportedUploadExtension(`doc${extension}`)).toBeTruthy();
    }
  });

  it('classifies by extension, case-insensitively', () => {
    expect(assertSupportedUploadExtension('Notes.MD')).toBe('markdown');
    expect(assertSupportedUploadExtension('report.PDF')).toBe('pdf');
    expect(assertSupportedUploadExtension('sheet.xlsx')).toBe('xlsx');
    expect(assertSupportedUploadExtension('memo.docx')).toBe('docx');
    expect(assertSupportedUploadExtension('rows.csv')).toBe('csv');
    expect(assertSupportedUploadExtension('server.log')).toBe('text');
  });

  it('tells the user how to fix a legacy Office file instead of just refusing', () => {
    expect(() => assertSupportedUploadExtension('memo.doc')).toThrow('save as .docx');
    expect(() => assertSupportedUploadExtension('book.xls')).toThrow('save as .xlsx');
    expect(() => assertSupportedUploadExtension('deck.pptx')).toThrow('Export the slides as PDF');
  });

  it('rejects anything else', () => {
    expect(() => assertSupportedUploadExtension('installer.exe')).toThrow('Unsupported file type');
    expect(() => assertSupportedUploadExtension('noextension')).toThrow('Unsupported file type');
  });
});

describe('extractDocument — text formats', () => {
  it('passes Markdown through untouched so its own headings survive', async () => {
    const source = '# Title\n\n## Section\n\nBody text.\n';
    const result = await extractDocument('notes.md', Buffer.from(source, 'utf8'));
    expect(result).toEqual({ text: source, documentType: 'markdown', truncated: false });
  });

  it('reads csv and plain text as-is', async () => {
    const csv = await extractDocument('rows.csv', Buffer.from('a,b\n1,2\n', 'utf8'));
    expect(csv.documentType).toBe('csv');
    expect(csv.text).toBe('a,b\n1,2\n');

    const log = await extractDocument('app.log', Buffer.from('boot ok', 'utf8'));
    expect(log.documentType).toBe('text');
  });

  it('decodes UTF-8 rather than mangling non-ASCII content', async () => {
    const result = await extractDocument('catatan.txt', Buffer.from('Ringkasan proyék — selesai', 'utf8'));
    expect(result.text).toBe('Ringkasan proyék — selesai');
  });

  it('rejects an empty document instead of indexing nothing', async () => {
    await expect(extractDocument('blank.txt', Buffer.from('   \n\t', 'utf8'))).rejects.toThrow(
      'No text could be extracted',
    );
  });

  it('truncates and reports it rather than silently indexing a fraction', async () => {
    const oversized = 'x'.repeat(MAX_EXTRACTED_CHARS + 500);
    const result = await extractDocument('big.txt', Buffer.from(oversized, 'utf8'));

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[Truncated: document exceeded');
    expect(result.text.length).toBeLessThan(oversized.length);
  });
});

describe('extractDocument — PDF', () => {
  it('extracts text and gives each page its own heading', async () => {
    const result = await extractDocument(
      'quarterly report.pdf',
      buildPdf(['Revenue grew in Jakarta', 'Costs fell in Bandung']),
    );

    expect(result.documentType).toBe('pdf');
    expect(result.text).toContain('# quarterly report');
    expect(result.text).toContain('## Page 1');
    expect(result.text).toContain('Revenue grew in Jakarta');
    expect(result.text).toContain('## Page 2');
    expect(result.text).toContain('Costs fell in Bandung');
  });

  it('explains that a text-free PDF needs OCR', async () => {
    await expect(extractDocument('scan.pdf', buildPdf([]))).rejects.toThrow('OCR');
  });
});

describe('extractDocument — XLSX', () => {
  it('renders each sheet as a heading plus pipe rows, skipping empty rows and sheets', async () => {
    const result = await extractDocument('adhoc query.xlsx', await buildXlsx());

    expect(result.documentType).toBe('xlsx');
    expect(result.text).toContain('# adhoc query');
    expect(result.text).toContain('## Revenue');
    expect(result.text).toContain('| Region | Amount | Signed |');
    expect(result.text).toContain('| Jakarta | 1500 | 2026-01-15 |');
    expect(result.text).toContain('| Bandung | 900 | 2026-02-02 |');
    // The blank row between the two data rows produced no output...
    expect(result.text).not.toContain('|  |  |  |');
    // ...and a sheet with no rows at all contributes no heading.
    expect(result.text).not.toContain('## Empty');
  });
});

describe('stripDataUriImages', () => {
  it('removes inline base64 images but keeps the surrounding prose and real links', () => {
    const markdown = 'Before ![chart](data:image/png;base64,AAAABBBBCCCC) after ![real](assets/x.png) end';

    expect(stripDataUriImages(markdown)).toBe('Before  after ![real](assets/x.png) end');
  });

  it('removes every occurrence, not just the first', () => {
    const markdown = `a![](data:image/png;base64,${'A'.repeat(5000)})b![](data:image/jpeg;base64,${'B'.repeat(5000)})c`;

    expect(stripDataUriImages(markdown)).toBe('abc');
  });
});
