import type { SearchResult } from './search';

export interface Bm25Doc {
  file: string;
  section: string;
  content: string;
  tokens: string[];
}

export interface Bm25Index {
  docs: Bm25Doc[];
  df: Map<string, number>;
  avgDocLen: number;
  n: number;
}

const K1 = 1.5;
const B = 0.75;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

/** Builds a BM25 index over a project's chunk corpus. No stopword list — BM25's own IDF term
 *  already drives near-ubiquitous words (across the project's own chunks) toward zero weight, so
 *  a separate stopword list would be redundant complexity for what it buys here. */
export function buildBm25Index(chunks: { file: string; section: string; content: string }[]): Bm25Index {
  const docs: Bm25Doc[] = chunks.map((c) => ({ ...c, tokens: tokenize(c.content) }));
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc.tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const totalLen = docs.reduce((sum, d) => sum + d.tokens.length, 0);
  return { docs, df, avgDocLen: docs.length > 0 ? totalLen / docs.length : 0, n: docs.length };
}

function scoreDoc(doc: Bm25Doc, queryTerms: string[], index: Bm25Index): number {
  const termFreq = new Map<string, number>();
  for (const t of doc.tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);

  let score = 0;
  for (const term of queryTerms) {
    const freq = termFreq.get(term);
    const docFreq = index.df.get(term);
    if (!freq || !docFreq) continue;
    const idf = Math.log((index.n - docFreq + 0.5) / (docFreq + 0.5) + 1);
    const lengthNorm = 1 - B + B * (doc.tokens.length / (index.avgDocLen || 1));
    score += (idf * (freq * (K1 + 1))) / (freq + K1 * lengthNorm);
  }
  return score;
}

/** Ranks the project's full chunk corpus by BM25 relevance to `query`, returning results already
 *  shaped like `SearchResult` with score normalized 0-1 against the batch's top hit (so it reads
 *  the same as a vector cosine score wherever it ends up displayed). A query with no matching
 *  terms just returns an empty array — a normal outcome, not a failure. */
export function bm25Search(index: Bm25Index, query: string, limit: number): SearchResult[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || index.n === 0) return [];

  const scored = index.docs
    .map((doc) => ({
      file: doc.file,
      section: doc.section,
      content: doc.content,
      score: scoreDoc(doc, queryTerms, index),
    }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const top = scored[0]?.score ?? 0;
  return top > 0 ? scored.map((r) => ({ ...r, score: r.score / top })) : scored;
}
