import type { Router } from 'express';
import type { AppDeps } from '../app';
import { dropCollection, getCollectionVectorSize } from '../../qdrant/qdrant-client';
import { createEmbeddingProvider } from '../../embedding/embedding-provider';
import type { CredentialsStore, CredentialInput, CredentialProvider } from '../../config/credentials-store';

export type ConnectionTestResult = { ok: true; latencyMs: number } | { ok: false; error: string };

interface Connection {
  provider: CredentialProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

/** One minimal, non-streaming completion — proves base URL, model and auth all work together. */
export async function testChatConnection(settings: Connection): Promise<ConnectionTestResult> {
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

/** Runs one real `embedQuery` — proves base URL, model and auth all work together. */
export async function testEmbeddingConnection(settings: Connection): Promise<ConnectionTestResult> {
  const started = Date.now();
  try {
    const provider = createEmbeddingProvider(settings);
    await provider.embedQuery('ping');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

interface CredentialBody {
  name?: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  models?: unknown;
}

function validModels(models: unknown): models is string[] {
  return Array.isArray(models) && models.length > 0 && models.every((m) => typeof m === 'string' && m.trim() !== '');
}

function parseNewCredential(body: CredentialBody): CredentialInput | { error: string } {
  if (!body.name || !body.name.trim()) return { error: 'name is required' };
  if (body.provider !== 'ollama' && body.provider !== 'openai') return { error: 'provider must be "ollama" or "openai"' };
  if (!body.baseUrl || !body.baseUrl.trim()) return { error: 'baseUrl is required' };
  if (!validModels(body.models)) return { error: 'models must be a non-empty array of strings' };
  return {
    name: body.name.trim(),
    provider: body.provider,
    baseUrl: body.baseUrl.trim(),
    apiKey: body.apiKey?.trim() || undefined,
    models: body.models.map((m) => m.trim()),
  };
}

function parseCredentialUpdate(body: CredentialBody): Partial<CredentialInput> | { error: string } {
  const update: Partial<CredentialInput> = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return { error: 'name cannot be blank' };
    update.name = body.name.trim();
  }
  if (body.provider !== undefined) {
    if (body.provider !== 'ollama' && body.provider !== 'openai') return { error: 'provider must be "ollama" or "openai"' };
    update.provider = body.provider;
  }
  if (body.baseUrl !== undefined) {
    if (!body.baseUrl.trim()) return { error: 'baseUrl cannot be blank' };
    update.baseUrl = body.baseUrl.trim();
  }
  if (body.apiKey) update.apiKey = body.apiKey.trim();
  if (body.models !== undefined) {
    if (!validModels(body.models)) return { error: 'models must be a non-empty array of strings' };
    update.models = body.models.map((m) => m.trim());
  }
  return update;
}

export interface CredentialsRouteDeps {
  store: CredentialsStore;
  testConnection: (conn: Connection) => Promise<ConnectionTestResult>;
}

/** Mounted twice — once for embedding, once for chat — each pointed at its own `CredentialsStore`. */
export function registerCredentialsRoutes(router: Router, deps: CredentialsRouteDeps): void {
  router.get('/', (_req, res) => {
    res.json(deps.store.list());
  });

  router.post('/', (req, res) => {
    const parsed = parseNewCredential(req.body ?? {});
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    res.status(201).json(deps.store.add(parsed));
  });

  router.put('/:id', (req, res) => {
    const parsed = parseCredentialUpdate(req.body ?? {});
    if ('error' in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      res.json(deps.store.update(req.params.id, parsed));
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/:id', (req, res) => {
    deps.store.remove(req.params.id);
    res.status(204).end();
  });

  router.post('/:id/activate', (req, res) => {
    const model = (req.body ?? {}).model;
    if (typeof model !== 'string' || !model.trim()) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    try {
      deps.store.setActive(req.params.id, model);
      res.json(deps.store.list());
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/test', async (req, res) => {
    const body = (req.body ?? {}) as { id?: string; provider?: string; baseUrl?: string; model?: string; apiKey?: string };
    if (body.provider !== 'ollama' && body.provider !== 'openai') {
      res.status(400).json({ error: 'provider must be "ollama" or "openai"' });
      return;
    }
    if (!body.baseUrl?.trim()) {
      res.status(400).json({ error: 'baseUrl is required' });
      return;
    }
    if (!body.model?.trim()) {
      res.status(400).json({ error: 'model is required' });
      return;
    }
    // A blank apiKey falls back to an already-saved credential's key, so testing a saved
    // credential doesn't require retyping it (the key is write-only in the UI).
    const apiKey = body.apiKey?.trim() || (body.id ? deps.store.getRawApiKey(body.id) : undefined);
    const result = await deps.testConnection({ provider: body.provider, baseUrl: body.baseUrl.trim(), model: body.model.trim(), apiKey });
    res.json(result);
  });
}

interface QdrantCollectionInfo {
  collection: string;
  exists: boolean;
  vectorSize?: number;
  pointsCount?: number;
  affectedProjectIds: string[];
}

async function getQdrantInfo(deps: AppDeps): Promise<QdrantCollectionInfo> {
  const affectedProjectIds = deps.registry.list().map((p) => p.id);
  const collections = await deps.qdrantClient.getCollections();
  const exists = collections.collections.some((c) => c.name === deps.qdrantCollection);
  if (!exists) {
    return { collection: deps.qdrantCollection, exists: false, affectedProjectIds };
  }
  const info = await deps.qdrantClient.getCollection(deps.qdrantCollection);
  return {
    collection: deps.qdrantCollection,
    exists: true,
    vectorSize: getCollectionVectorSize(info),
    pointsCount: info.points_count ?? undefined,
    affectedProjectIds,
  };
}

export function registerSettingsRoutes(router: Router, deps: AppDeps): void {
  router.get('/qdrant', async (_req, res) => {
    res.json(await getQdrantInfo(deps));
  });

  // Destructive across every registered project — the collection is shared, not per-project —
  // so this requires an explicit `confirm: true` rather than just a bare POST.
  router.post('/qdrant/drop-collection', async (req, res) => {
    const body = (req.body ?? {}) as { confirm?: boolean };
    if (body.confirm !== true) {
      res.status(400).json({ error: 'confirm must be true to drop the collection' });
      return;
    }
    const affectedProjectIds = deps.registry.list().map((p) => p.id);
    await dropCollection(deps.qdrantClient, deps.qdrantCollection);
    res.json({ dropped: true, affectedProjectIds });
  });
}
