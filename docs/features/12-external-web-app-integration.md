# External Web App Integration (RAG Retrieval API)

**Status: Implemented.** This guide is for developers of a *separate* web app that already has its own AI chat feature and just needs relevant document context to feed into it — not RAGBuddy's own internals.

## 1) What You Get

Once a project is set up in RAGBuddy, your app can send a query and get back the most relevant chunks of that project's documentation — ranked with the same retrieval pipeline RAGBuddy's own chat feature uses (hybrid vector + keyword search, query rewriting, reranking) — without running your own vector database, embedding model, or retrieval pipeline. You plug the returned chunks into your own chat/LLM as context; RAGBuddy never generates an answer for you.

Base URL: `http://<host-running-ragbuddy>:4300` (default port `4300`; the person running RAGBuddy may have changed it with `--port`).

Everything in this doc is also presented live inside the dashboard itself — sidebar → **RAG Integration** (`web/src/pages/rag-integration.tsx`, route `/dashboard/integration`): the actual base URL, registered project ids (copy-button ready), the same `/search`/`/chat` request/response shapes with curl + JS examples, and a live API-key/dashboard-login status summary. Point whoever is integrating at that page instead of this file if they have dashboard access — it stays in sync with the real server state.

## 2) Before You Start (one-time, done by whoever administers RAGBuddy)

Someone must have already, in the RAGBuddy dashboard or CLI:
1. Registered your project/repository in RAGBuddy.
2. Configured an embedding provider (used internally for retrieval).
3. Synced the project's docs at least once, so there's something to retrieve.
4. Configured a chat provider (OpenAI or Ollama) — used internally to improve retrieval quality (query rewriting + reranking), not to generate a chat answer.

You don't need to touch any of this from your integrating app — just get the **project id** from whoever set it up, or fetch it yourself:

```
GET /api/projects
```
Response: an array of projects, each with an `id` field. Use that `id` in the URL below.

## 3) Retrieval Endpoint

```
POST /api/projects/:id/search
Content-Type: application/json
```

**Request body:**
```json
{
  "query": "How does incremental sync work?",
  "history": [
    { "role": "user", "content": "Tell me about the sync feature" },
    { "role": "assistant", "content": "It re-indexes only changed files..." }
  ]
}
```
| Field | Required | Notes |
|---|---|---|
| `query` | yes | The question or search phrase to retrieve context for. |
| `history` | no | Prior turns of *your own* conversation, `{ role: "user" \| "assistant", content: string }[]`. Only used to resolve follow-up references in `query` (e.g. "what about that?") into a self-contained search — omit it for a one-off query with no prior context. |

**Response** (plain JSON, `200 OK`):
```json
{
  "results": [
    { "file": "docs/features/03-incremental-sync.md", "section": "Flow", "score": 0.81, "content": "..." }
  ]
}
```
- `results` — ranked best-first, each with the source `file`/`section`, a relevance `score`, and the chunk `content` text to feed into your own LLM prompt as context.
- `results` can be an empty array — that just means nothing relevant was found; it's not an error.
- `error` — present only if retrieval itself failed (e.g. the embedding provider is unreachable). `results` will be `[]` in that case. Absence of `error` does not mean something was found, just that retrieval ran without failing.

**Example (JavaScript):**
```js
async function getRagContext(baseUrl, projectId, query, history = []) {
  const res = await fetch(`${baseUrl}/api/projects/${projectId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, history }),
  });
  const { results, error } = await res.json();
  if (error) console.warn('RAGBuddy retrieval error:', error);
  return results; // feed these into your own chat/LLM prompt as context
}
```

**Example (curl, to sanity-check the endpoint manually):**
```bash
curl -X POST http://localhost:4300/api/projects/YOUR_PROJECT_ID/search \
  -H "Content-Type: application/json" \
  -d '{"query":"How does incremental sync work?"}'
```

**Example response** (for the request above):
```json
{
  "results": [
    {
      "file": "docs/features/03-incremental-sync.md",
      "section": "Flow / Behavior",
      "score": 0.83,
      "content": "On `git commit`/`git pull`/`git checkout`, the hook diffs each tracked file's hash against the last indexed run. Unchanged files are skipped entirely; only added, modified, or deleted files trigger an embed/upsert or delete against Qdrant."
    },
    {
      "file": "docs/features/06-git-hook-auto-sync.md",
      "section": "Scheduled re-sync fallback",
      "score": 0.74,
      "content": "`ragbuddy sync-all` calls the same `syncProject` path once per registered project, in sequence, isolating failures per project."
    }
  ]
}
```
When nothing relevant is found: `{ "results": [] }`. When retrieval itself fails (e.g. embedding provider unreachable): `{ "results": [], "error": "embedding provider unreachable: ECONNREFUSED" }`.

**Using the results in your own chat:** join the returned chunks into a context block and prepend it to your own LLM call, e.g.:
```js
const context = results.map(r => `File: ${r.file}\n${r.content}`).join('\n---\n');
const systemPrompt = `Answer using the following project context when relevant:\n${context}`;
// ...pass systemPrompt + the user's question to your own chat/LLM as usual
```

## 4) Hardening for External Callers (optional)

By default RAGBuddy assumes a trusted caller on a private network — no authentication, no CORS headers. That's fine for an internal tool on the same network. If your integration is a browser-based app on a different origin, or reaches RAGBuddy over a network you don't fully trust, ask whoever runs RAGBuddy to turn on either or both of these:

- **API key** — generated from RAGBuddy's own **Settings page** ("API access" section: Generate key / Rotate key / Remove key), or by setting `RAGBUDDY_API_KEY` before first start. Once configured, every request to `/api/*` must include it, or it gets rejected with `401`. Send it either way:
  ```
  Authorization: Bearer YOUR_KEY
  ```
  or
  ```
  X-API-Key: YOUR_KEY
  ```
  The key is shown in plaintext only once, right after it's generated — copy it immediately, since RAGBuddy never displays it again afterward (only whether one is configured).
- **CORS allowlist** — set via the `RAGBUDDY_ALLOWED_ORIGINS` environment variable (no dashboard toggle for this one yet). Once your origin (e.g. `https://your-app.example.com`) is added, calling this endpoint directly from your app's browser-side JavaScript works normally; origins not on the list are still blocked by the browser as before.

If neither is enabled on the RAGBuddy instance you're integrating with, you still have two options: call from your own app's **backend** instead of browser JS (sidesteps the CORS restriction entirely, since CORS only applies to browsers), or ask the administrator to turn on the API key / allowlist above.

Separately, RAGBuddy's dashboard itself can require a login code for human/browser access (see [13-dashboard-login-auth.md](./13-dashboard-login-auth.md)) — that gate is bypassed by a valid API key, so turning it on never breaks your integration above.

**Still true regardless of these options:** there's no per-caller rate limiting — a single RAGBuddy instance serves all callers with shared capacity — and the API key is a single shared secret for the whole instance, not one per integrating app.

**For whoever runs RAGBuddy:** the API key is managed from the Settings page — no restart needed, and no env var required unless you want one pre-set before the first launch. The CORS allowlist is still env-only for now:
```
RAGBUDDY_ALLOWED_ORIGINS=https://your-app.example.com,https://another-app.example.com
```
Use `*` to allow any origin (only reasonable alongside a configured API key — otherwise anyone's browser can call the API). Note: once a key is set, RAGBuddy's own dashboard needs it too (it's just another caller) — the dashboard stores the key in its browser's local storage right after you generate it and attaches it automatically from then on. If you ever get locked out of the dashboard itself (different browser, cleared storage), delete `config/api-key.json` (or unset `RAGBUDDY_API_KEY`) and restart the server to reopen access.

## 5) If You Don't Have Your Own Chat Yet

RAGBuddy also exposes a full RAG-grounded chat endpoint, in case your app has no chat feature of its own and would rather let RAGBuddy generate the answer too, instead of just returning context chunks.

```
POST /api/projects/:id/chat
Content-Type: application/json
```

**Request body:**
```json
{
  "messages": [
    { "role": "user", "content": "How does incremental sync work?" }
  ],
  "useRag": true
}
```
| Field | Required | Notes |
|---|---|---|
| `messages` | yes | Non-empty array of `{ role: "user" \| "assistant", content: string }`. Stateless — you own conversation history and send the full running transcript each call. |
| `useRag` | no | Defaults to `true`. Set `false` for a plain chat completion with no document retrieval. |

**Response:** `Content-Type: text/event-stream` (Server-Sent Events), not a single JSON payload — read it as it arrives.

**Example raw response stream** (for the request above):
```
event: token
data: {"text":"Incremental"}

event: token
data: {"text":" sync"}

event: token
data: {"text":" re-indexes"}

event: token
data: {"text":" only files whose hash changed since the last run..."}

event: sources
data: {"sources":[{"file":"docs/features/03-incremental-sync.md","section":"Flow / Behavior","score":0.83}]}

event: done
data: {}

```
If the request fails mid-stream, an `error` event (`{"message": "..."}`) is sent instead of `done`.

**Example (JavaScript, works in a browser or Node with `fetch`):**
```js
async function askRagBuddy(baseUrl, projectId, question) {
  const res = await fetch(`${baseUrl}/api/projects/${projectId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let answer = '';
  let sources = [];

  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const event = chunk.match(/^event: (\w+)/m)?.[1];
      const data = chunk.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      if (event === 'token') answer += parsed.text;
      if (event === 'sources') sources = parsed.sources;
    }
  }
  return { answer, sources };
}
```

**Example (curl, to sanity-check the endpoint manually):**
```bash
curl -N -X POST http://localhost:4300/api/projects/YOUR_PROJECT_ID/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"How does incremental sync work?"}]}'
```

Optional feedback endpoint (thumbs up/down on an answer, visible in RAGBuddy's own dashboard — not required to integrate):
```
POST /api/projects/:id/chat/feedback
{ "query": "...", "answer": "...", "rating": "up" | "down", "sources": [...] }
```

## Cross-References

- [04-retrieval-search.md](./04-retrieval-search.md) — how the underlying retrieval pipeline (rewrite → hybrid search → rerank) works
- [09-project-chat.md](./09-project-chat.md) — RAGBuddy's own dashboard chat, built on the same retrieval pipeline plus its own chat endpoint
- [10-chat-provider-settings.md](./10-chat-provider-settings.md) — how the chat/embedding providers are configured
- [03-incremental-sync.md](./03-incremental-sync.md) — how a project's docs get indexed in the first place
