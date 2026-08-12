import type { ActiveConnection } from '../config/credentials-store';
import { completeOnce } from '../chat/complete-once';

const REWRITE_SYSTEM_PROMPT =
  'Generate 2 alternative phrasings of the following search query, to broaden document retrieval. ' +
  'Reply with exactly one alternative phrasing per line, no numbering, no explanation, no extra commentary.';

/** Broadens retrieval recall for short/ambiguous chat queries by asking the LLM for a couple of
 *  alternative phrasings before embedding. The original query is always first in the returned list
 *  (a bad or failed rewrite can never fully replace it), and any failure — timeout, malformed
 *  response, upstream error — falls back to just the original query rather than blocking RAG. */
export async function rewriteQuery(query: string, settings: ActiveConnection): Promise<string[]> {
  const trimmed = query.trim();
  try {
    const raw = await completeOnce(
      REWRITE_SYSTEM_PROMPT,
      [{ role: 'user', content: trimmed }],
      settings,
      'Query rewrite',
      8_000,
    );
    const variants = raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.toLowerCase() !== trimmed.toLowerCase());
    return [trimmed, ...variants];
  } catch {
    return [trimmed];
  }
}
