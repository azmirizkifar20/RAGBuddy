import type { ActiveConnection } from '../config/credentials-store';
import { completeOnce } from '../chat/complete-once';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

const REWRITE_SYSTEM_PROMPT =
  'Given the conversation so far and the latest user query, generate 2 alternative phrasings of the ' +
  'latest query that would broaden document retrieval. Resolve any pronoun or implicit reference in the ' +
  'latest query (e.g. "that", "it", "the one you mentioned") using the conversation history, so each ' +
  'phrasing is a self-contained search query even out of context. Reply with exactly one alternative ' +
  'phrasing per line, no numbering, no explanation, no extra commentary.';

/** Broadens retrieval recall for short/ambiguous chat queries by asking the LLM for a couple of
 *  alternative phrasings before embedding, using recent conversation turns (if any) to resolve
 *  follow-up references ("what about that?") into standalone queries. The original query is always
 *  first in the returned list (a bad or failed rewrite can never fully replace it), and any failure —
 *  timeout, malformed response, upstream error — falls back to just the original query rather than
 *  blocking RAG. */
export async function rewriteQuery(
  query: string,
  settings: ActiveConnection,
  history: ConversationTurn[] = [],
): Promise<string[]> {
  const trimmed = query.trim();
  try {
    const raw = await completeOnce(
      REWRITE_SYSTEM_PROMPT,
      [...history, { role: 'user', content: trimmed }],
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
