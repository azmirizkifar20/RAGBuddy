# Chat Provider Settings

**Status: Implemented**. Chat's own provider, base URL, model, and API key — separate from the embedding provider used for RAG retrieval — editable at runtime from the Settings page, with a "Test connection" check. Extends [09-project-chat.md](./09-project-chat.md) and [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md).

## 1) What This Feature Is

Before this feature, [AI Chat](./09-project-chat.md) reused the embedding provider's config for chat completion too (`EMBEDDING_PROVIDER`/`EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY`), on the assumption both came from the same source. In practice they often don't — RAG retrieval and chat completion frequently come from different providers/hosts. This feature gives chat its own independent provider/base URL/model/API key, editable from **Settings** without a server restart, plus a way to verify a config actually works before relying on it.

1. **Independent chat config** — `provider` (`ollama` | `openai`), `baseUrl`, `model`, `apiKey` for chat, entirely decoupled from the embedding provider's config. RAG retrieval (embedding the query, searching Qdrant) is untouched and keeps using the embedding provider.
2. **Runtime-editable, no restart** — unlike the rest of `/api/config` (still read once from `.env` at startup), chat settings live in a small JSON file the server re-reads on every request, and the Settings page writes to it directly over HTTP.
3. **Test connection** — sends one real, minimal, non-streaming chat completion to the base URL/model/API key currently in the form (not necessarily saved yet), so a broken base URL, wrong model id, or bad key surfaces immediately instead of on the next real chat message.
4. **Write-only API key** — the key is never sent back to the browser, only whether one is configured (`apiKeyConfigured: boolean`), matching the same convention the embedding API key already followed. Saving with a blank key keeps whatever key is already stored; saving with a new value replaces it.

## 2) Flow / Behavior

### Defaults (first run)

`ChatSettingsStore` is seeded from the exact values chat used to inherit — `EMBEDDING_PROVIDER`, `EMBEDDING_BASE_URL`, `CHAT_MODEL`, `EMBEDDING_API_KEY` — so a server that has never touched this feature behaves identically to before. Only once the Settings page saves an override does `config/chat-settings.json` (path from `CHAT_SETTINGS_PATH`, default `./config/chat-settings.json`) start taking precedence.

### Read path (every chat request)

```
POST /api/projects/:id/chat
  → deps.chatSettings.get()  (fresh disk read, not cached at process start)
  → RAG (if useRag): embed query via the EMBEDDING provider, search Qdrant  — unchanged
  → chat completion via the CHAT provider/baseUrl/model/apiKey just read
```

### Write path (Settings page)

```
Settings page → PUT /api/settings/chat { provider, baseUrl, model, apiKey? }
  → validate provider is "ollama"|"openai", baseUrl and model non-empty
  → ChatSettingsStore.save(): blank/omitted apiKey keeps the currently-stored key
  → writes config/chat-settings.json
  → next chat request picks it up immediately (no restart)
```

### Test connection

```
Settings page → POST /api/settings/chat/test { provider, baseUrl, model, apiKey? }
  → blank apiKey falls back to the already-saved key (so testing a saved config
    doesn't require retyping its key)
  → one non-streaming completion request, 15s timeout
  → { ok: true, latencyMs } | { ok: false, error }
```

## 3) Routes

| Route | Purpose |
|-------|---------|
| `GET /api/settings/chat` | Current chat settings (`{ provider, baseUrl, model, apiKeyConfigured }`) |
| `PUT /api/settings/chat` | Save new chat settings; returns the same shape as `GET` |
| `POST /api/settings/chat/test` | Test a provider/baseUrl/model/apiKey combination live; returns `{ ok: true, latencyMs }` or `{ ok: false, error }` |

None of these are project-scoped — chat settings are global, mounted at `/api/settings`, separate from the `/api/projects/:id/...` router.

## 4) Domain

- **`src/config/chat-settings-store.ts`** — `ChatSettingsStore`: `get()` (disk read + defaults merge), `getPublic()` (strips the API key), `save()` (write-only key semantics — see above).
- **`src/server/routes/settings.ts`** — `registerSettingsRoutes`: the three routes above, shared `parseChatSettingsBody` validation, `testChatConnection` (the live completion check).
- **`src/server/routes/chat.ts`** — `summarize`/`streamOpenAI`/`streamOllama` now take a `ChatSettings` object instead of reading `deps.chatModel`/`deps.embeddingBaseUrl`/`deps.embeddingApiKey`/`deps.runtime.embeddingProvider`; the main handler calls `deps.chatSettings.get()` once per request.
- **`src/cli/index.ts`** — constructs the `ChatSettingsStore` for the `web` command, seeded from `loadConfig()`'s embedding/chat defaults.

## 5) UI

- **`web/src/pages/settings.tsx`** — new "Chat" section between the read-only "Embeddings" and "Paths" groups: a `Select` (provider), two `Input`s (model, base URL), a password-type `Input` (API key, placeholder indicates whether one is already configured), a **Save** button, and a **Test connection** button showing an inline success (latency) or error message.
- **`web/src/components/ui/select.tsx`** — a plain native `<select>` styled to match `Input`; no Radix primitive needed for a two-option list.
- **`web/src/lib/api-client.ts`** — `getChatSettings`, `updateChatSettings`, `testChatConnection`.

## 6) Data Shape

```ts
interface ChatSettings {
  provider: 'ollama' | 'openai'
  baseUrl: string
  model: string
  apiKey?: string        // never sent to the client
}
interface ChatSettingsPublic {
  provider: 'ollama' | 'openai'
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
}
```

Persisted at `config/chat-settings.json` (gitignored, like `config/projects.json`'s local state — not checked in).

## 7) Security Notes

- The API key is write-only end-to-end: accepted in `PUT`/`POST .../test` request bodies, never present in any `GET` response.
- `config/chat-settings.json` can contain a real API key on disk — same trust boundary as `.env` (local, single-user, not committed).
- This is a local-only dashboard (no auth layer, per the rest of the app) — settings changes and connection tests are reachable by anything that can reach `localhost:4300`.

## Related Files

- `src/config/chat-settings-store.ts`
- `src/server/routes/settings.ts`
- `src/server/routes/chat.ts`
- `src/server/app.ts`
- `src/cli/index.ts`
- `web/src/pages/settings.tsx`
- `web/src/components/ui/select.tsx`
- `web/src/lib/api-client.ts`

## Cross-References

- Extends: [09-project-chat.md](./09-project-chat.md), [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md)
- Design system: [../design-system/README.md](../design-system/README.md)
- API conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
