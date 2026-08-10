import type { Router } from 'express';
import type { AppDeps } from '../app';
import type { ChatProvider, ChatSettingsUpdate } from '../../config/chat-settings-store';

interface ChatSettingsBody {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

function parseChatSettingsBody(body: ChatSettingsBody): ChatSettingsUpdate | { error: string } {
  const { provider, baseUrl, model, apiKey } = body;
  if (provider !== 'ollama' && provider !== 'openai') {
    return { error: 'provider must be "ollama" or "openai"' };
  }
  if (!baseUrl || !baseUrl.trim()) {
    return { error: 'baseUrl is required' };
  }
  if (!model || !model.trim()) {
    return { error: 'model is required' };
  }
  return { provider, baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey?.trim() };
}

/** One minimal, non-streaming completion — proves base URL, model and auth all work together. */
async function testChatConnection(
  settings: { provider: ChatProvider; baseUrl: string; model: string; apiKey?: string },
): Promise<{ ok: true; latencyMs: number } | { ok: false; error: string }> {
  const started = Date.now();
  const url = settings.provider === 'openai' ? `${settings.baseUrl}/chat/completions` : `${settings.baseUrl}/api/chat`;
  const body =
    settings.provider === 'openai'
      ? { model: settings.model, messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 4 }
      : { model: settings.model, messages: [{ role: 'user', content: 'ping' }], stream: false };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.provider === 'openai' && settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      // ponytail: fixed 15s timeout for a connectivity check — no need for a caller-supplied signal here.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `${res.status} ${res.statusText}${text ? `: ${text.slice(0, 300)}` : ''}` };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function registerSettingsRoutes(router: Router, deps: AppDeps): void {
  router.get('/chat', (_req, res) => {
    res.json(deps.chatSettings.getPublic());
  });

  router.put('/chat', (req, res) => {
    const parsed = parseChatSettingsBody(req.body ?? {});
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    deps.chatSettings.save(parsed);
    res.json(deps.chatSettings.getPublic());
  });

  router.post('/chat/test', async (req, res) => {
    const parsed = parseChatSettingsBody(req.body ?? {});
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    // A blank apiKey in the test request falls back to whatever is already
    // saved, so testing a saved config doesn't require retyping its key.
    const apiKey = parsed.apiKey || deps.chatSettings.get().apiKey;
    const result = await testChatConnection({ ...parsed, apiKey });
    res.json(result);
  });
}
