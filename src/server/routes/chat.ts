import type { Router } from 'express';
import type { AppDeps } from '../app';
import { startSse, sendSseEvent } from '../sse';
import { searchProject } from '../../retrieval/search';

export interface ContentPartText {
  type: 'text';
  text: string;
}
export interface ContentPartImage {
  type: 'image_url';
  image_url: { url: string };
}
export type ContentPart = ContentPartText | ContentPartImage;

export interface ChatMsg {
  role: 'user' | 'assistant';
  content: string | ContentPart[];
}

interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

interface Source {
  file: string;
  section: string;
  score: number;
}

const RAG_SYSTEM_PROMPT =
  'You are a helpful assistant. Answer the user using the provided project documents as context. ' +
  'If the answer is not in the documents, say so clearly instead of guessing. ' +
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

function toProviderMessages(
  messages: LlmMessage[],
  provider: 'ollama' | 'openai',
): Array<{ role: string; content: string | ContentPart[]; images?: string[] }> {
  if (provider === 'openai') {
    return messages.map((m) => ({ role: m.role, content: m.content }));
  }
  return messages.map((m) => {
    const { text, images } = flattenContent(m.content);
    return { role: m.role, content: text, ...(images.length ? { images } : {}) };
  });
}

async function summarize(
  messages: ChatMsg[],
  deps: AppDeps,
  provider: 'ollama' | 'openai',
): Promise<string> {
  const providerMessages = toProviderMessages(messages, provider);
  const body = {
    model: deps.chatModel,
    messages: [
      { role: 'system', content: 'Summarize the following conversation in a compact 1-2 sentence summary.' },
      ...providerMessages,
    ],
    stream: false,
  };
  const url = provider === 'openai' ? `${deps.embeddingBaseUrl}/chat/completions` : `${deps.embeddingBaseUrl}/api/chat`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider === 'openai' && deps.embeddingApiKey) headers.Authorization = `Bearer ${deps.embeddingApiKey}`;
  // ponytail: fixed 30s timeout for the blocking summarize call; the streaming path below uses the client abort signal
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Summarize request failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; message?: { content?: string } };
  if (provider === 'openai') return json.choices?.[0]?.message?.content ?? '';
  return json.message?.content ?? '';
}

async function streamOpenAI(
  res: Parameters<typeof sendSseEvent>[0],
  deps: AppDeps,
  messages: Array<{ role: string; content: string | ContentPart[]; images?: string[] }>,
  signal: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (deps.embeddingApiKey) headers.Authorization = `Bearer ${deps.embeddingApiKey}`;
  const response = await fetch(`${deps.embeddingBaseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: deps.chatModel, messages, stream: true }),
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
  deps: AppDeps,
  messages: Array<{ role: string; content: string | ContentPart[]; images?: string[] }>,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(`${deps.embeddingBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: deps.chatModel, messages, stream: true }),
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
    const provider: 'ollama' | 'openai' = deps.runtime.embeddingProvider === 'openai' ? 'openai' : 'ollama';

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
          summary = await summarize(pruned, deps, provider);
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
      if (useRag) {
        const query = lastUserText(messages);
        if (query.trim()) {
          try {
            const results = await searchProject(project.id, query, {
              qdrantClient: deps.qdrantClient,
              qdrantCollection: deps.qdrantCollection,
              embeddingProvider: deps.embeddingProvider,
              topK: deps.ragTopK,
            });
            sources = results.map((r) => ({ file: r.file, section: r.section, score: r.score }));
            if (results.length > 0) {
              const context = results
                .map((r) => `File: ${r.file}\nContent: ${r.content}`)
                .join('\n---\n');
              llmMessages.push({
                role: 'system',
                content: `Use these project documents to answer. If the answer is not in them say you don't know.\n---\n${context}\n---`,
              });
            }
          } catch {
            // RAG failed; continue answering without context
          }
        }
      }

      const providerMessages = toProviderMessages(llmMessages, provider);
      if (provider === 'openai') {
        await streamOpenAI(res, deps, providerMessages, controller.signal);
      } else {
        await streamOllama(res, deps, providerMessages, controller.signal);
      }

      if (useRag) sendSseEvent(res, 'sources', { sources });
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
}