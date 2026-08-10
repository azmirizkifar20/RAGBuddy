# Provider Credentials (Embedding & Chat)

**Status: Implemented**. Both the embedding provider (used for indexing + RAG retrieval) and the chat provider now support **saving more than one named credential**, each holding one or more model names, with one (credential, model) pair marked active — editable at runtime from the Settings page, with a "Test connection" check per credential. Supersedes the original single-active-config version of this feature (chat-only); extends [09-project-chat.md](./09-project-chat.md) and [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md).

## 1) What This Feature Is

Originally, chat had its own single editable provider/base URL/model/API key, independent of the embedding provider — but both were still "one active config, edit in place." That became painful in practice: switching between providers (e.g. a local Ollama model vs. a hosted proxy) meant overwriting the one saved config and retyping everything to switch back. This feature replaces "one active config" with **a list of named credentials you switch between** — for both embedding and chat, as two independent lists (they usually come from different sources and are never meant to share one list).

1. **Credential = a connection + its models** — `{ name, provider ('ollama' | 'openai'), baseUrl, apiKey, models: string[] }`. One credential can hold several model names (e.g. one Gemini-backed proxy credential with `["gemini-embedding-2-preview", "jina-embeddings-v5-text-nano"]`).
2. **One (credential, model) pair is active at a time**, per list. Switching is a single "activate" call — pick a credential, pick one of its models — no retyping base URL/API key to go back to a previous setup.
3. **Two independent lists** — embedding credentials and chat credentials never mix, matching how RAG retrieval and chat completion already came from different sources before this feature existed.
4. **`.env` seeds the first credential** in each list (named `"Default (.env)"`), so a server that has never touched this feature behaves identically to before. A prior single-config chat save (the old feature's file shape) is migrated in place into a one-credential list the first time it's read — nothing is lost upgrading.
5. **Runtime-editable, no restart** — same as before, both stores are re-read from disk on every request rather than cached at process start.
6. **Test connection** — sends one real minimal request (a non-streaming chat completion for chat; one `embedQuery('ping')` for embedding) using a credential's fields, optionally falling back to its already-saved API key by id so testing a saved credential doesn't require retyping the key.
7. **Write-only API key**, per credential — never sent back to the browser, only `apiKeyConfigured: boolean`. Omitting it on an update keeps whatever is already stored.
8. **Switching the active embedding credential/model warns first** — a different embedding model very likely produces vectors of a different size than whatever is already indexed (the exact failure explored in [2026-08-10_ingest-loses-progress-on-dimension-mismatch.md](../issue/2026-08-10_ingest-loses-progress-on-dimension-mismatch.md)); the UI shows a confirmation dialog before activating a non-active model, explaining that every project needs re-ingesting afterward. Chat switching has no such warning — a chat model mismatch has no analogous "silently wrong until re-ingest" failure mode.

## 2) Flow / Behavior

### Read path (every operation that needs a provider)

```
Any embedding use (ingest/sync/search/upload/chat RAG)
  → resolveEmbeddingProvider(deps)          (src/server/app.ts)
  → deps.embeddingCredentials.get()          fresh disk read, resolves the active (credential, model)
  → createEmbeddingProvider({...})           a fresh provider instance, not cached across requests

POST /api/projects/:id/chat
  → deps.chatCredentials.get()               same resolution, for chat
  → chat completion via that provider/baseUrl/model/apiKey
```

### Write path (Settings page)

```
Settings page → POST   /api/settings/{embedding|chat}          add a new credential
              → PUT    /api/settings/{embedding|chat}/:id       update one (blank apiKey keeps the saved one)
              → DELETE /api/settings/{embedding|chat}/:id       remove one (falls back to another if it was active)
              → POST   /api/settings/{embedding|chat}/:id/activate  { model }  — must be one of that credential's models
              → POST   /api/settings/{embedding|chat}/test      { provider, baseUrl, model, apiKey?, id? }
```

## 3) Routes

The exact same five routes are mounted twice — once at `/api/settings/embedding`, once at `/api/settings/chat` — pointed at two independent `CredentialsStore` instances.

| Route | Purpose |
|-------|---------|
| `GET /api/settings/{embedding\|chat}` | `{ credentials: [{id, name, provider, baseUrl, apiKeyConfigured, models}], activeCredentialId, activeModel }` |
| `POST /api/settings/{embedding\|chat}` | Add a credential; `{name, provider, baseUrl, apiKey?, models}` → `201` with the created (public) credential |
| `PUT /api/settings/{embedding\|chat}/:id` | Update a credential; any field omitted is left unchanged, blank `apiKey` keeps the saved one |
| `DELETE /api/settings/{embedding\|chat}/:id` | Remove a credential; `204` |
| `POST /api/settings/{embedding\|chat}/:id/activate` | `{model}` → sets this (credential, model) as active; `400` if `model` isn't one of this credential's saved models |
| `POST /api/settings/{embedding\|chat}/test` | Test a connection live; `id` optional (falls back to that credential's saved key if `apiKey` is blank) |

Also unchanged, mounted separately at `/api/settings` (not per-kind): `GET /api/settings/qdrant`, `POST /api/settings/qdrant/drop-collection` — see [02-ingestion-full-index.md](./02-ingestion-full-index.md). None of these routes are project-scoped.

## 4) Domain

- **`src/config/credentials-store.ts`** — `CredentialsStore`: generic, instantiated twice (embedding, chat). `list()`, `get()` (resolves the active pair into `{provider, baseUrl, model, apiKey}`, throws if none is active), `getRawApiKey(id)` (for the test-connection fallback), `add`/`update`/`remove`/`setActive`. Seeds from a fixed `id: 'default'` credential (so re-reading an unwritten seed is idempotent) built from whatever seed object the caller passes in. Also migrates the old single-flat-config file shape (`{provider, baseUrl, model, apiKey}`) into a one-credential list in place, the first time such a file is read.
- **`src/server/app.ts`** — `AppDeps.embeddingCredentials`/`chatCredentials: CredentialsStore` replace the old fixed `embeddingProvider: EmbeddingProvider` instance and `chatSettings: ChatSettingsStore`. `resolveEmbeddingProvider(deps)` is the one place that turns the active embedding credential into a real `EmbeddingProvider`, called fresh in every route that embeds something (`ingest.ts`, `sync.ts`, `search.ts`, `uploads.ts`, `chat.ts`'s RAG path).
- **`src/server/routes/settings.ts`** — `registerCredentialsRoutes(router, {store, testConnection})`, mounted twice in `app.ts`; `testChatConnection` (unchanged) and new `testEmbeddingConnection` (`createEmbeddingProvider(...).embedQuery('ping')`).
- **`src/cli/index.ts`** — constructs both `CredentialsStore` instances (seeded from `loadConfig()`), resolves the embedding provider fresh right before each command (`ingest`/`sync`/`search`/`mcp`) instead of once at process start — so a long-running `ragbuddy mcp`/`ragbuddy web` process picks up a Settings-page change without restarting.

## 5) UI

- **`web/src/components/credentials-manager.tsx`** — `CredentialsManager` (mounted twice in Settings, once per `kind`): lists credentials as cards (name, provider, base URL, key-configured indicator, an "Active" badge, model chips), each model chip clickable to activate it; inline edit (pencil icon → the same form used for adding, pre-filled) and remove (trash icon, no confirm — matches the low blast radius of one credential) per card; an "Add credential" form (name, provider `Select`, base URL, API key, comma-separated models) with its own inline Test-connection check. `warnOnSwitch` (embedding only) wraps each non-active model chip in an `AlertDialog` confirming the re-ingest requirement before activating.
- **`web/src/pages/settings.tsx`** — two `CredentialsManager` sections (embedding, chat) replace the old read-only "Embeddings" group and the old single-form "Chat" section.
- **`web/src/pages/project-mcp.tsx`** — the "embedding model in use" note now reads from `getCredentials('embedding')`'s active pair instead of the now-removed `RuntimeConfig.embeddingModel`/`embeddingProvider` fields.
- **`web/src/lib/api-client.ts`** — `getCredentials`, `addCredential`, `updateCredential`, `removeCredential`, `activateCredential`, `testCredentialConnection`, all parameterized by `kind: 'embedding' | 'chat'`.

## 6) Data Shape

```ts
interface Credential {
  id: string
  name: string
  provider: 'ollama' | 'openai'
  baseUrl: string
  apiKey?: string          // never sent to the client
  models: string[]
}
interface CredentialPublic {
  id: string; name: string; provider: 'ollama' | 'openai'; baseUrl: string
  apiKeyConfigured: boolean; models: string[]
}
interface CredentialsFile {
  credentials: Credential[]
  activeCredentialId: string | null
  activeModel: string | null
}
```

Persisted at `config/embedding-credentials.json` (new, path from `EMBEDDING_CREDENTIALS_PATH`) and `config/chat-settings.json` (same file/path as before — kept so the migration above has something real to migrate; both gitignored, like `config/projects.json`'s local state).

## 7) Security Notes

- The API key is write-only end-to-end, per credential: accepted in `POST`/`PUT`/`.../test` bodies, never present in any `GET` response.
- Both credential files can contain real API keys on disk — same trust boundary as `.env` (local, single-user, not committed).
- This is a local-only dashboard (no auth layer, per the rest of the app) — settings changes and connection tests are reachable by anything that can reach `localhost:4300`.

## Related Files

- `src/config/credentials-store.ts`
- `src/server/routes/settings.ts`
- `src/server/routes/{chat,ingest,sync,search,uploads}.ts`
- `src/server/app.ts`
- `src/cli/index.ts`
- `web/src/components/credentials-manager.tsx`
- `web/src/pages/{settings,project-mcp}.tsx`
- `web/src/components/ui/select.tsx`
- `web/src/lib/api-client.ts`

## Cross-References

- Extends: [09-project-chat.md](./09-project-chat.md), [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md)
- Depends on / interacts with: [02-ingestion-full-index.md](./02-ingestion-full-index.md) (the embedding-dimension guard and `qdrant drop-collection`)
- Design system: [../design-system/README.md](../design-system/README.md)
- API conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
