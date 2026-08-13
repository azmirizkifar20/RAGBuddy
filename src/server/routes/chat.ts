import type { Router } from 'express';
import { type AppDeps, resolveEmbeddingProvider } from '../app';
import { startSse, sendSseEvent } from '../sse';
import { hybridSearch } from '../../retrieval/hybrid-search';
import { rewriteQuery, type ConversationTurn } from '../../retrieval/query-rewrite';
import { rerank } from '../../retrieval/rerank';
import type { ActiveConnection as ChatSettings } from '../../config/credentials-store';
import { completeOnce, toProviderMessages, type ContentPart, type LlmMessage } from '../../chat/complete-once';

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

interface Source {
  file: string;
  section: string;
  score: number;
}

/** How much larger a candidate pool `hybridSearch` fetches than the final `ragTopK`,
 * giving `rerank` something to actually reorder instead of just re-scoring the same top few. */
const RERANK_POOL_MULTIPLIER = 3;

/** How many of the most recent messages (before the current query) get sent to `rewriteQuery` for
 * follow-up reference resolution — a small window, not the full conversation, since this call is
 * only meant to disambiguate "that"/"it"-style references, not re-read the whole session. */
const REWRITE_HISTORY_TURNS = 4;

const RAG_SYSTEM_PROMPT =
  'You are a helpful assistant. Project documents may be attached as extra context below — treat them as a ' +
  'supplementary reference, not the only source you are allowed to answer from. Prefer them when they are ' +
  "relevant, but if they don't cover the question, answer normally using your own general knowledge instead of " +
  "refusing or saying the information isn't available. Only say you don't know when you genuinely have no " +
  'answer to give, with or without the documents. ' +
  // Unquoted Mermaid labels break the parser the moment they contain punctuation,
  // numbering or brackets — quoting every label is the one rule that avoids
  // almost all of it, and the dashboard renders these diagrams inline.
  'When you draw a Mermaid diagram, wrap every node and edge label in double quotes, ' +
  'e.g. A["Scan docs"] -->|"on commit"| B["Qdrant"]. ' +
  'Never leave a label unquoted when it contains punctuation, numbering, parentheses or slashes.';

function flattenContent(content: string | ContentPart[]): { text: string; images: string[] } {
  if (typeof content === 'string') return { text: content, images: [] };
  let text = '';
  const images: string[] = [];
  for (const part of content) {
    if (part.type === 'text') text += part.text;
    else images.push(part.image_url.url);
  }
  return { text, images };
}

function lastUserText(messages: ChatMsg[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return flattenContent(messages[i].content).text;
  }
  return '';
}

/** The conversation turns preceding the current query (assumed to be the final message), capped
 * to a small trailing window — see `REWRITE_HISTORY_TURNS`. */
function recentHistory(messages: ChatMsg[]): ConversationTurn[] {
  return messages
    .slice(0, -1)
    .slice(-REWRITE_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: flattenContent(m.content).text }));
}

async function summarize(messages: ChatMsg[], settings: ChatSettings): Promise<string> {
  // ponytail: fixed 30s timeout for the blocking summarize call; the streaming path below uses the client abort signal
  return completeOnce(
    'Summarize the following conversation in a compact 1-2 sentence summary.',
    messages,
    settings,
    'Summarize',
    30_000,
  );
}

async function generateTitle(userMessage: string, assistantMessage: string, settings: ChatSettings): Promise<string> {
  const raw = await completeOnce(
    'Generate a short, specific title (3-6 words) summarizing what this conversation is about. ' +
      'Reply with the title as plain text only — no markdown, no bold/italics/backticks, no quotes, no trailing punctuation.',
    [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: assistantMessage },
    ],
    settings,
    'Title',
    20_000,
  );
  // Belt-and-suspenders: models don't reliably follow "no markdown" — strip
  // emphasis/code markers and quotes wherever they land, not just the edges.
  return raw
    .replace(/[*_`]/g, '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .slice(0, 60);
}

async function streamOpenAI(
  res: Parameters<typeof sendSseEvent>[0],
  settings: ChatSettings,
  messages: Array<{ role: string; content: string | ContentPart[]; images?: string[] }>,
  signal: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: settings.model, messages, stream: true }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed: ${response.status} ${response.statusText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) sendSseEvent(res, 'token', { text: delta });
      } catch {
        // skip malformed SSE line
      }
    }
  }
}

async function streamOllama(
  res: Parameters<typeof sendSseEvent>[0],
  settings: ChatSettings,
  messages: Array<{ role: string; content: string | ContentPart[]; images?: string[] }>,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${settings.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings.model, messages, stream: true }),
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed: ${response.status} ${response.statusText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed) as { message?: { content?: string } };
        const chunk = json.message?.content;
        if (typeof chunk === 'string' && chunk) sendSseEvent(res, 'token', { text: chunk });
      } catch {
        // skip malformed NDJSON line
      }
    }
  }
}

export function registerChatRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/chat', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const body = (req.body ?? {}) as { messages?: ChatMsg[]; useRag?: boolean };
    const messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages must be a non-empty array' });
      return;
    }
    const useRag = body.useRag !== false;
    const settings = deps.chatCredentials.get();

    startSse(res);
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const llmMessages: LlmMessage[] = [{ role: 'system', content: RAG_SYSTEM_PROMPT }];

      if (messages.length > deps.chatContextLimit) {
        const pruned = messages.slice(0, messages.length - deps.chatContextLimit);
        const keep = messages.slice(messages.length - deps.chatContextLimit);
        let summary = '';
        try {
          summary = await summarize(pruned, settings);
        } catch {
          // fall back to generic notice; never crash
        }
        const summaryText = summary && summary.trim() ? summary.trim() : 'Earlier conversation omitted for context limit.';
        llmMessages.push({ role: 'system', content: `Summary of earlier conversation: ${summaryText}` });
        llmMessages.push(...keep);
      } else {
        llmMessages.push(...messages);
      }

      let sources: Source[] = [];
      // Set only when retrieval itself throws (e.g. an embedding-model/vector-size
      // mismatch) — never for "ran fine, found nothing relevant", which is a
      // normal outcome and stays silent. Surfaced to the client below so a
      // config problem shows up as a visible notice instead of a context-free
      // answer that looks like RAG quietly found nothing.
      let ragError: string | undefined;
      if (useRag) {
        const query = lastUserText(messages);
        if (query.trim()) {
          try {
            // Broaden recall with a couple of history-aware rewritten phrasings, run both dense
            // vector search and a lexical BM25 pass over the project corpus (fused by
            // hybridSearch), over-fetch a candidate pool, then let the LLM reorder it — each step
            // degrades to a simpler behavior on its own failure (see rewriteQuery/hybridSearch/
            // rerank), so a flaky call never blocks RAG, it just falls back the next step down.
            const queries = await rewriteQuery(query, settings, recentHistory(messages));
            const candidates = await hybridSearch(project.id, queries, query, {
              qdrantClient: deps.qdrantClient,
              qdrantCollection: deps.qdrantCollection,
              embeddingProvider: resolveEmbeddingProvider(deps),
              topK: deps.ragTopK * RERANK_POOL_MULTIPLIER,
              bm25VersionKey: deps.statsStore.get(project.id)?.updatedAt ?? '',
            });
            const results = await rerank(query, candidates, settings, deps.ragTopK);
            sources = results.map((r) => ({ file: r.file, section: r.section, score: r.score }));
            if (results.length > 0) {
              const context = results
                .map((r) => `File: ${r.file}\nContent: ${r.content}`)
                .join('\n---\n');
              llmMessages.push({
                role: 'system',
                content: `Relevant project documents (supplementary context — use your own knowledge too if these don't fully cover the question):\n---\n${context}\n---`,
              });
            }
          } catch (error) {
            ragError = error instanceof Error ? error.message : String(error);
          }
        }
      }

      const providerMessages = toProviderMessages(llmMessages, settings.provider);
      if (settings.provider === 'openai') {
        await streamOpenAI(res, settings, providerMessages, controller.signal);
      } else {
        await streamOllama(res, settings, providerMessages, controller.signal);
      }

      if (useRag) sendSseEvent(res, 'sources', { sources, ...(ragError ? { ragError } : {}) });
      sendSseEvent(res, 'done', {});
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.writableEnded) {
        try {
          sendSseEvent(res, 'error', { message });
          res.end();
        } catch {
          // client already gone
        }
      }
    }
  });

  // Best-effort: the client calls this once, after the first exchange in a new
  // session, to replace the "New chat" placeholder with something topical.
  // Failure here is never fatal — the session just keeps its placeholder title.
  router.post('/:id/chat/title', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const body = (req.body ?? {}) as { userMessage?: string; assistantMessage?: string };
    if (!body.userMessage || !body.assistantMessage) {
      res.status(400).json({ error: 'userMessage and assistantMessage are required' });
      return;
    }
    try {
      const title = await generateTitle(body.userMessage, body.assistantMessage, deps.chatCredentials.get());
      res.json({ title });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // 👍/👎 on a chat answer — logged so which queries the RAG pipeline is failing on is reviewable
  // across sessions/devices instead of living only in one browser's localStorage.
  router.post('/:id/chat/feedback', (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const body = (req.body ?? {}) as { query?: string; answer?: string; rating?: string; sources?: Source[] };
    if (!body.query || !body.answer || (body.rating !== 'up' && body.rating !== 'down')) {
      res.status(400).json({ error: 'query, answer, and rating ("up" or "down") are required' });
      return;
    }
    try {
      const record = deps.chatFeedback.append({
        project: project.id,
        query: body.query,
        answer: body.answer,
        rating: body.rating,
        sources: Array.isArray(body.sources) ? body.sources : [],
      });
      res.json({ id: record.id });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}