import type { ActiveConnection } from '../config/credentials-store';
import { completeOnce } from '../chat/complete-once';
import type { SearchResult } from './search';

const RERANK_SYSTEM_PROMPT =
  'You will be given a question and a numbered list of document snippets. Reply with ONLY a JSON ' +
  'array of the snippet numbers, best match for the question first. Include every number exactly ' +
  'once. Example reply: [2,0,1]';

/** Cosine similarity is a proxy for relevance, not relevance itself — a snippet that scores well by
 *  vector distance can still fail to answer the actual question. This asks the LLM to reorder a
 *  candidate pool (normally larger than the final topK) in one batched call, then cuts to topK.
 *  Any failure — timeout, non-JSON reply, indices that don't parse — falls back to the original
 *  (vector-score) order, so a flaky rerank call degrades gracefully instead of breaking RAG. */
export async function rerank(
  query: string,
  candidates: SearchResult[],
  settings: ActiveConnection,
  topK: number,
): Promise<SearchResult[]> {
  if (candidates.length <= topK) return candidates;

  try {
    const listing = candidates.map((c, i) => `${i}. [${c.file}] ${c.content.slice(0, 300)}`).join('\n');
    const raw = await completeOnce(
      RERANK_SYSTEM_PROMPT,
      [{ role: 'user', content: `Question: ${query}\n\nSnippets:\n${listing}` }],
      settings,
      'Rerank',
      10_000,
    );
    const order = JSON.parse(raw.trim()) as unknown;
    if (!Array.isArray(order) || order.length === 0) throw new Error('rerank response was not a non-empty array');

    const reordered: SearchResult[] = [];
    const used = new Set<number>();
    for (const i of order) {
      if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < candidates.length && !used.has(i)) {
        used.add(i);
        reordered.push(candidates[i]);
      }
    }
    // The model may have dropped an index — append any leftover candidates in
    // their original (vector-score) order so nothing is silently lost before the slice.
    for (let i = 0; i < candidates.length; i++) {
      if (!used.has(i)) reordered.push(candidates[i]);
    }
    return reordered.slice(0, topK);
  } catch {
    return candidates.slice(0, topK);
  }
}
