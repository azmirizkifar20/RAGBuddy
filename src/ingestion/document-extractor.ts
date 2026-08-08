import path from 'node:path';

export type UploadDocumentType = 'markdown' | 'text' | 'csv' | 'pdf' | 'docx' | 'xlsx';

export interface ExtractedDocument {
  /** Markdown-shaped text, so the existing heading-aware chunker still applies. */
  text: string;
  documentType: UploadDocumentType;
  /** Set when the extracted text hit MAX_EXTRACTED_CHARS and was cut short. */
  truncated: boolean;
}

/**
 * Every extension the dashboard accepts, and how each one is read. Text
 * formats are decoded directly; the three binary formats go through a parser.
 * This is deliberately separate from the repository scanner's list — indexing
 * a PDF someone happens to have committed is a different decision from a user
 * explicitly uploading one.
 */
const EXTENSION_TYPES: Record<string, UploadDocumentType> = {
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.markdown': 'markdown',
  '.txt': 'text',
  '.text': 'text',
  '.log': 'text',
  '.rst': 'text',
  '.adoc': 'text',
  '.json': 'text',
  '.yaml': 'text',
  '.yml': 'text',
  '.csv': 'csv',
  '.tsv': 'csv',
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
};

/**
 * Pre-2007 Office formats are a completely different container that none of
 * our parsers read. Saying so beats "unsupported file type" — the fix is one
 * Save As away.
 */
const LEGACY_FORMAT_HINTS: Record<string, string> = {
  '.doc': 'Legacy .doc is not supported — open it in Word and save as .docx.',
  '.xls': 'Legacy .xls is not supported — open it in Excel and save as .xlsx.',
  '.ppt': 'PowerPoint files are not supported. Export the slides as PDF and upload that.',
  '.pptx': 'PowerPoint files are not supported. Export the slides as PDF and upload that.',
};

// ponytail: a 20MB spreadsheet can flatten into millions of characters, which
// would be thousands of embedding calls from one upload. Cap it and report the
// cut rather than silently indexing a fraction of the document.
export const MAX_EXTRACTED_CHARS = 1_000_000;

export const SUPPORTED_UPLOAD_EXTENSIONS = Object.keys(EXTENSION_TYPES);

export function uploadTypeForExtension(extension: string): UploadDocumentType | undefined {
  return EXTENSION_TYPES[extension.toLowerCase()];
}

/** Throws with an actionable message when the extension can't be indexed. */
export function assertSupportedUploadExtension(filename: string): UploadDocumentType {
  const extension = path.extname(filename).toLowerCase();
  const type = uploadTypeForExtension(extension);
  if (type) return type;

  const hint = LEGACY_FORMAT_HINTS[extension];
  if (hint) throw new Error(hint);
  throw new Error(
    `Unsupported file type "${extension || 'none'}" — allowed: ${SUPPORTED_UPLOAD_EXTENSIONS.join(', ')}`,
  );
}

export async function extractDocument(filename: string, data: Buffer): Promise<ExtractedDocument> {
  const documentType = assertSupportedUploadExtension(filename);
  const title = path.basename(filename, path.extname(filename));

  // Each parser returns only the document's own content. The `# title`
  // heading is added afterwards, so an empty result stays detectably empty
  // instead of looking like a one-line document that just says its filename.
  let body: string;
  if (documentType === 'pdf') body = await extractPdf(data);
  else if (documentType === 'docx') body = await extractDocx(data);
  else if (documentType === 'xlsx') body = await extractXlsx(data);
  else body = data.toString('utf8');

  if (!body.trim()) {
    throw new Error(
      documentType === 'pdf'
        ? 'No text could be extracted — this PDF looks like scanned images with no text layer. Run it through OCR first.'
        : 'No text could be extracted from this document.',
    );
  }

  // Text formats keep their own structure; only converted binaries get a
  // synthetic title, since they have no Markdown heading of their own.
  let text = documentType === 'pdf' || documentType === 'docx' || documentType === 'xlsx'
    ? `# ${title}\n\n${body}`
    : body;

  const truncated = text.length > MAX_EXTRACTED_CHARS;
  if (truncated) {
    text = `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[Truncated: document exceeded ${MAX_EXTRACTED_CHARS} characters.]`;
  }

  return { text, documentType, truncated };
}

async function extractPdf(data: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    const result = await parser.getText();
    // Page headings give the chunker real boundaries and let a citation point
    // at a page instead of at the whole file.
    const pages = (result.pages ?? [])
      .map((page) => ({ num: page.num, text: (page.text ?? '').trim() }))
      .filter((page) => page.text !== '')
      .map((page) => `## Page ${page.num}\n\n${page.text}`);
    return pages.length > 0 ? pages.join('\n\n') : (result.text ?? '').trim();
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(data: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  // convertToMarkdown is real but missing from the bundled types; it keeps
  // Word's heading levels as Markdown headings, which is what lets the
  // existing heading-aware chunker split the document sensibly.
  const convert = (mammoth as unknown as {
    convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  }).convertToMarkdown;
  const result = await convert({ buffer: data });
  return stripDataUriImages(result.value).trim();
}

/**
 * mammoth inlines embedded images as base64 data URIs. Two photos in a real
 * Word file turned a 7KB article into 8.5MB of text that is pure noise to an
 * embedding model, so they are dropped before chunking.
 */
export function stripDataUriImages(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\(data:[^)]*\)/g, '');
}

async function extractXlsx(data: Buffer): Promise<string> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data as unknown as ArrayBuffer);

  const sheets = workbook.worksheets.map((sheet) => {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = Array.isArray(row.values) ? row.values.slice(1) : [];
      const line = cells.map(cellText);
      if (line.some((value) => value !== '')) rows.push(`| ${line.join(' | ')} |`);
    });
    return rows.length > 0 ? `## ${sheet.name}\n\n${rows.join('\n')}` : '';
  });

  return sheets.filter(Boolean).join('\n\n');
}

/** ExcelJS cells hold dates, formula results and rich text, not just strings. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const cell = value as { text?: unknown; result?: unknown; richText?: { text?: string }[]; hyperlink?: string };
    if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text ?? '').join('');
    if (cell.text !== undefined) return String(cell.text);
    if (cell.result !== undefined) return String(cell.result);
    if (cell.hyperlink) return cell.hyperlink;
    return '';
  }
  return String(value).replace(/\r?\n/g, ' ').trim();
}
