import type { ActiveConnection } from '../config/credentials-store';

export interface ContentPartText {
  type: 'text';
  text: string;
}
export interface ContentPartImage {
  type: 'image_url';
  image_url: { url: string };
}
export type ContentPart = ContentPartText | ContentPartImage;

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentPart[];
}

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

export function toProviderMessages(
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

/** One blocking, non-streaming completion — shared by any caller that needs a single LLM
 *  answer (chat summarize/title, and the retrieval layer's query-rewrite/rerank helpers)
 *  rather than a token stream. */
export async function completeOnce(
  systemPrompt: string,
  messages: LlmMessage[],
  settings: ActiveConnection,
  label: string,
  timeoutMs: number,
): Promise<string> {
  const providerMessages = toProviderMessages(messages, settings.provider);
  const body = {
    model: settings.model,
    messages: [{ role: 'system', content: systemPrompt }, ...providerMessages],
    stream: false,
  };
  const url = settings.provider === 'openai' ? `${settings.baseUrl}/chat/completions` : `${settings.baseUrl}/api/chat`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.provider === 'openai' && settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${label} request failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; message?: { content?: string } };
  if (settings.provider === 'openai') return json.choices?.[0]?.message?.content ?? '';
  return json.message?.content ?? '';
}
