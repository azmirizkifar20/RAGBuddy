import { parseMarkdown } from './parser';

export interface Chunk {
  title: string;
  section: string;
  content: string;
  chunkIndex: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

// ponytail: char-count token approximation (~4 chars/token per init.md §8);
// swap for a real tokenizer if chunk boundaries ever need token precision
const DEFAULT_CHUNK_SIZE = 4000;
const DEFAULT_OVERLAP = 400;

export function chunkMarkdown(content: string, options: ChunkOptions = {}): Chunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (overlap >= chunkSize) {
    throw new Error('overlap must be smaller than chunkSize');
  }

  const sections = parseMarkdown(content);
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    if (section.content.length <= chunkSize) {
      chunks.push({
        title: section.title,
        section: section.heading,
        content: section.content,
        chunkIndex: chunkIndex++,
      });
      continue;
    }
    let start = 0;
    while (start < section.content.length) {
      const end = Math.min(start + chunkSize, section.content.length);
      chunks.push({
        title: section.title,
        section: section.heading,
        content: section.content.slice(start, end),
        chunkIndex: chunkIndex++,
      });
      if (end >= section.content.length) break;
      start = end - overlap;
    }
  }

  return chunks;
}
