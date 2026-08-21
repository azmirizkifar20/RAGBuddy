# Per-Project Chat

**Status: Implemented**. Adds a streaming chat interface to the dashboard (extends [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md)). Chat lives at its own top-level sidebar page (`/dashboard/chat`), not nested under a project's detail tabs — but every chat is still scoped to one project: starting a new chat requires picking a project first (a picker screen at `/dashboard/chat` with no project selected), and once picked (`/dashboard/chat/:projectId`) you can ask questions grounded in that project's indexed documents, toggle retrieval on or off, attach files, and keep multiple sessions. No chat history is stored on the server; every session lives in the browser's `localStorage`, keyed per project, so moving the page didn't lose or migrate any existing session.

## 1) What This Feature Is

1. **Streaming chat per project** — a `POST /api/projects/:id/chat` endpoint that streams the model's reply token-by-token over SSE, with optional RAG grounding.
2. **Multi-session, client-persisted** — any number of named chat sessions per project, stored in `localStorage` under `project-rag:chats:${projectId}` (kept as-is through the rename so existing sessions aren't orphaned). Nothing chat-related is written to the server or Qdrant.
3. **Conditional RAG** — a "Use RAG" toggle controls whether the last user message is routed through the retrieval layer and injected as context.
4. **Control + rich input** — a Stop button aborts mid-stream via `AbortController`, starter prompts seed a new session, and attachments (images and text-like files) can be dragged or picked.
5. **Custom markdown renderer** — striped scrollable tables, collapsible code blocks with a copy button, and inline-code badges, rendered without `dangerouslySetInnerHTML`.

## 2) Flow / Behavior

### Chat flow

```
Compose message (text + optional attachments/images)
  → SSE POST /api/projects/:id/chat
      → validate project + messages (400/404 on failure)
      → optional auto-compaction: if message count > CHAT_CONTEXT_LIMIT,
        summarize the pruned prefix and inject the summary as a system message
      → optional RAG: getRagResults(text, history) — shared with `ragbuddy ask`, see 04-retrieval-search.md
          = rewriteQuery(text, history) → hybridSearch(pool=topK*3) → rerank(topK)
          hybridSearch = searchProjectMultiQuery (vector) + BM25 lexical pass, fused by RRF
        → inject retrieved chunks as a system context message
      → route to LLM provider (OpenAI chat/completions vs Ollama /api/chat),
        streaming tokens
  → SSE events: token* → sources* → done | error
  → client streams tokens into the active session, persists to localStorage
```

The request is a single SSE stream. The client reads frames and dispatches on the `event:` field. The server mounts the router at `/api/projects` (see `app.ts`), so the full route is `POST /api/projects/:id/chat`.

### Auto-compaction

When the incoming `messages` array exceeds `CHAT_CONTEXT_LIMIT` (default `10`), the server:

1. Splits off the oldest messages (`pruned`) from the newest `chatContextLimit` (`keep`).
2. Calls a blocking summarize pass over the pruned messages (fixed 30s `AbortSignal.timeout`).
3. Injects the summary as a `system` message, then appends `keep`.
4. On summarize failure it falls back to the generic notice `Earlier conversation omitted for context limit.` and never crashes.

### Conditional RAG

`useRag` defaults to `true` (`body.useRag !== false`). When enabled, the server takes the last user message's text and runs it through the query rewriting → multi-query retrieval → reranking pipeline below (project filter always enforced at the storage layer, per `docs/steering/architecture.md`, regardless of how many query variants or reranked candidates are involved). If any chunks come back, they are joined into a `system` message framed as **supplementary** context ("use your own knowledge too if these don't fully cover the question") — retrieved docs inform the answer, they don't gate it, so a question outside the project's docs still gets a real answer from the model's own knowledge instead of a refusal. When disabled, the message is sent without any retrieval. A RAG failure (including from Qdrant/the embedding provider) is caught and the conversation continues without context; the client sees it as `ragError` on the `sources` event.

### Query rewriting, hybrid search & reranking

Additions on top of the plain `searchProject` that CLI `search`/MCP still use unchanged (see [04-retrieval-search.md](./04-retrieval-search.md)), chained together by the shared `getRagResults` (`src/retrieval/rag-context.ts`) — extracted out of this route so `ragbuddy ask` (2026-08-13) could reuse the exact same pipeline instead of re-implementing it:

1. **`rewriteQuery`** (`src/retrieval/query-rewrite.ts`) — one blocking LLM call (`completeOnce`) asks for 2 alternative phrasings of the user's question, to broaden recall for short/ambiguous chat queries. It also receives the last `REWRITE_HISTORY_TURNS` (4) messages preceding the query, so a follow-up like "how does that work?" gets resolved against the conversation instead of rewritten as a context-free fragment. The original query is always kept first in the returned list, and any failure (timeout, empty/unusable response) falls back to `[originalQuery]` — a bad rewrite never blocks or replaces the real query.
2. **`hybridSearch`** (`src/retrieval/hybrid-search.ts`) — runs `searchProjectMultiQuery` (dense vector search, one call per rewritten variant, over-fetching a pool of `ragTopK * 3`) **and** a lexical BM25 pass (`src/retrieval/bm25.ts`) over the project's full chunk corpus against the *original* query only (the rewritten variants are semantic paraphrases meant for vector recall — running BM25 against them too would just dilute exact-term matching). The two ranked lists are fused by Reciprocal Rank Fusion, so a chunk that BM25 finds (an exact function name, error code, or file path that never scores high on cosine similarity) can surface even when vector search missed it entirely. Each result keeps its *original* score (vector score when present in both lists) rather than the RRF value, so the "% match" the UI shows stays meaningful. The BM25 index itself is built lazily per project and cached in-process, invalidated only when the project's cached stats `updatedAt` changes (`src/retrieval/bm25-index.ts` — reuses the same cache-invalidation signal as `ProjectStatsStore`, so it never re-scrolls the full corpus on every chat message). Any failure in the BM25 pass (index build, Qdrant scroll) falls back to vector-only results.
3. **`rerank`** (`src/retrieval/rerank.ts`) — a second blocking LLM call asks the model to reorder the fused candidate pool by actual relevance to the question (cosine similarity is a proxy, not the real thing), then cuts to `ragTopK`. Skipped entirely — no LLM call — when the pool is already at or under `ragTopK`. Any failure (timeout, non-JSON reply, out-of-range indices) falls back to the fused order.

The two LLM calls (rewrite, rerank) reuse `completeOnce` (`src/chat/complete-once.ts`, also shared by `summarize`/title generation below) and the same `chatCredentials` connection as the answer itself — no separate provider config. Each adds one blocking round-trip before the answer starts streaming (rewrite always; rerank only when there are more candidates than `ragTopK`); the BM25 pass adds no LLM round-trip, only an occasional Qdrant scroll on a cache miss. Every step degrades to a simpler behavior on its own failure rather than surfacing an error.

### Answer feedback (2026-08-13)

Each assistant reply gets 👍/👎 buttons in the UI. Rating an answer:

1. Updates the message's `feedback` field locally (persisted in the same `localStorage` session blob as everything else) — clicking the active rating again clears it.
2. Fires `POST /api/projects/:id/chat/feedback` (`{ query, answer, rating, sources }`, `query` resolved as the nearest preceding user message) best-effort — a failed write never disrupts the chat UI, matching every other non-critical call in this pipeline.
3. The server appends it to `ChatFeedbackStore` (`src/history/chat-feedback.ts`, same append/list/cap-at-500/corrupt-file-is-empty shape as `SyncHistoryStore`), at `data/chat-feedback.json`.

This exists so which queries the RAG pipeline is actually failing on is reviewable across sessions and devices — today by reading `data/chat-feedback.json` directly (no dashboard view was built for it; add one if this needs to be browsable in the UI, YAGNI for now) — rather than living only in one browser's fading memory of "that answer felt off."

### Provider routing

The provider/base URL/model/API key come from `deps.chatCredentials.get()` (resolving the active credential+model from a list you can add to and switch between) — **independent of the embedding provider** used for RAG retrieval above (see [10-chat-provider-settings.md](./10-chat-provider-settings.md)), editable at runtime from **Settings** with no restart. OpenAI hits `${baseUrl}/chat/completions` with `Authorization: Bearer ${apiKey}`; Ollama hits `${baseUrl}/api/chat`. Images ride the request as `image_url` parts for OpenAI and as an `images` array for Ollama.

## 3) Routes

| Route | Purpose |
|-------|---------|
| `POST /api/projects/:id/chat` | Streaming chat for one project. 404 if the project is not registered, 400 if `messages` is empty or not an array |
| `POST /api/projects/:id/chat/title` | `{ userMessage, assistantMessage }` → `{ title }`, one non-streaming completion generating a short session title. 404/400 the same way as above; a provider failure is a 500, which the client treats as best-effort and ignores (session keeps its placeholder title) |
| `POST /api/projects/:id/chat/feedback` | `{ query, answer, rating: "up"\|"down", sources? }` → `{ id }`. 404 for an unregistered project, 400 if `query`/`answer` is missing or `rating` isn't `"up"`/`"down"`. Appends to `ChatFeedbackStore` (2026-08-13) |

### Request body

```json
{
  "messages": [
    { "role": "user", "content": "How does auto-sync work?" },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": [
      { "type": "text", "text": "What is this?" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
    ] }
  ],
  "useRag": true
}
```

`content` is either a plain string or an array of `text` / `image_url` parts. `useRag` is optional and defaults to `true`.

### SSE events

| Event | Payload | Meaning |
|-------|---------|---------|
| `token` | `{ text: string }` | One model token delta |
| `sources` | `{ sources: [{ file, section, score }] }` | Sent once after streaming when RAG was used |
| `done` | `{}` | Stream finished cleanly |
| `error` | `{ message: string }` | A failure occurred; stream ends |

`sources` is only emitted when `useRag` is true. The client dispatches on these exact event names in `streamProjectChat`.

## 4) Domain

- **`src/server/routes/chat.ts`** — `registerChatRoutes`; the endpoint, auto-compaction, RAG injection (one `getRagResults` call), provider routing, the OpenAI/Ollama streaming paths, and the feedback endpoint. Helpers `flattenContent`, `lastUserText`, `summarize`, `recentHistory` (the trailing conversation window fed to `rewriteQuery` via `getRagResults`). Provider/base URL/model/API key come from `deps.chatCredentials.get()` — see [10-chat-provider-settings.md](./10-chat-provider-settings.md) — not from the embedding config.
- **`src/retrieval/rag-context.ts`** — `getRagResults`: the shared rewrite → hybrid search → rerank pipeline, used by this route and by `ragbuddy ask` (2026-08-13, see [04-retrieval-search.md](./04-retrieval-search.md)).
- **`src/history/chat-feedback.ts`** — `ChatFeedbackStore`: append/list/cap-at-500 JSON store for 👍/👎 ratings, same shape as `SyncHistoryStore`.
- **`src/chat/complete-once.ts`** — `completeOnce` (one blocking, non-streaming completion), `toProviderMessages`, `ContentPart`/`LlmMessage` types. Shared by `summarize`/title generation here and by `rewriteQuery`/`rerank` in the retrieval layer, so neither depends on `server/routes`.
- **`src/server/app.ts`** — mounts the chat router at `/api/projects`, threads `chatCredentials`/`embeddingCredentials` (both `CredentialsStore`) / `chatContextLimit` / `statsStore` / `chatFeedback` through `AppDeps` and mounts the generic credential routes twice at `/api/settings/{embedding,chat}`.
- **`src/config/config.ts`** — `chatModel` (default `gpt-4o-mini` for OpenAI, `llama3` for Ollama) and `chatContextLimit` (default `10`), validated against `CHAT_MODEL` / `CHAT_CONTEXT_LIMIT`; `chatModel` (plus the embedding provider/base URL/API key) only seeds `chatCredentials`' first (`"Default (.env)"`) credential now — the values actually used per request come from whichever credential+model is active in that store, not straight from `AppConfig`.
- **`src/retrieval/search.ts`** — `searchProject` (the same project-filtered topK search an agent hits, unchanged) plus `searchProjectMultiQuery` (additive: runs `searchProject` per query variant and merges/dedupes, used via `getRagResults`).
- **`src/retrieval/query-rewrite.ts`** — `rewriteQuery`: generates alternative phrasings before retrieval, history-aware via an optional `ConversationTurn[]` parameter.
- **`src/retrieval/hybrid-search.ts`** — `hybridSearch`: fuses `searchProjectMultiQuery` (vector) with a BM25 lexical pass via Reciprocal Rank Fusion.
- **`src/retrieval/bm25.ts`** — `buildBm25Index`/`bm25Search`: pure, dependency-free BM25 (k1=1.5, b=0.75) over a project's chunk corpus, no stopword list (IDF already downweights ubiquitous terms).
- **`src/retrieval/bm25-index.ts`** — `getBm25Index`: in-memory per-project cache for the BM25 index, invalidated by a `versionKey` (the project's cached stats `updatedAt`).
- **`src/qdrant/qdrant-repository.ts`** — `getProjectChunks`: full-corpus `{file, section, content}` scroll feeding the BM25 index build.
- **`src/retrieval/rerank.ts`** — `rerank`: reorders/truncates a candidate pool by relevance.

## 5) UI

- **`web/src/pages/ai-chat.tsx`** — the top-level chat page, rendered for both `/chat` and `/chat/:projectId` (`web/src/App.tsx`), sidebar entry "AI Chat" (`web/src/components/layout/sidebar.tsx`).
  - `/chat` (no `projectId`) — a project picker: a centered heading, then a card per registered project (from `useProjects()`) linking to `/chat/:projectId`. Each card's subtitle ("N saved chat(s)" / "No chats yet") is read directly from that project's `localStorage` key, so returning users can see their history is intact before clicking in.
  - `/chat/:projectId` — fetches the project via `getProject(id)` (the same call `ProjectLayout` makes, just done locally instead of through `useProjectContext()`, since this page is not nested under `ProjectLayout`) and then renders the chat room: session list, active session, message list, input, Use RAG toggle, Stop button, attachments, starter prompts, streaming dots, source chips.
  - The old `/projects/:id/chat` tab and route are gone — `ProjectLayout`'s `TABS` no longer lists a Chat entry.
- **`web/src/components/formatted-chat-message.tsx`** — custom renderer: `splitBlocks` parses fenced code, `|`-tables, and paragraphs; `renderInline` turns inline code, bold, and links into React nodes. Tables are wrapped in a scrollable container with striped rows; code blocks are collapsible with a copy button; nothing is injected as raw HTML.
- **`web/src/lib/api-client.ts`** — `streamProjectChat` reads the SSE body, splits frames on blank lines, and dispatches `token` / `sources` / `error` / `done` to handlers. It aborts cleanly when the caller's `AbortSignal` fires.

### Multi-session behavior

- Persistence: `localStorage`, key `project-rag:chats:${projectId}` (unchanged since before the rename), value `{ sessions, activeId }`. Loaded on mount, written on every change. Corrupt storage is ignored and the UI starts fresh.
- Sessions: `new` (random UUID id, title `New chat`), `rename`, `delete`, and `switch`. If no sessions exist, one is created automatically.
- **Sort & grouping**: the session list is sorted most-recent-activity-first by `updatedAt` (falling back to `createdAt` for sessions predating that field), then grouped by calendar day — "Today", "Yesterday", then a formatted date (year included only if not the current year). `updatedAt` is bumped whenever a message is appended (user send or assistant reply/error) — not on rename or title generation, so tidying up a title doesn't bump a stale session back to the top or between groups. Sorting/grouping happens in a derived `sessionGroups` view (`groupSessionsByDay`); the underlying `sessions` state itself stays in insertion order.
- **Auto-titling**: once the first exchange in a session finishes, the client calls `POST /api/projects/:id/chat/title` (`{ userMessage, assistantMessage }`) and, if it succeeds, replaces the placeholder title with the short LLM-generated one — best-effort, never blocks sending or the reply, and never overwrites a title the user already renamed by hand in the meantime. Starter-prompt sessions get an instant truncated-text title first (unchanged behavior), then get upgraded to the generated one once it resolves.
- `MAX_SENT_MESSAGES = 30` caps the number of sent user messages kept per session.
- Stop: an `AbortController` is held in a ref during streaming; the button aborts it, which ends the SSE read and discards the partial assistant message.
- Attachments: text-like files (`text/*`, plus `.txt .md .markdown .csv .pdf`) are read and appended to the message as `[Attached File: name]` text; images (`image/png`, `image/jpeg`, `image/webp`) are stored as data URLs and sent as `image_url` parts. Attachments and images can be attached or removed before send.
- Drag and drop: the **whole conversation column** is the drop zone, not just the composer — dropping a file anywhere else would hit the browser default and navigate away from the chat. Several files can be dropped at once, mixing images and documents. While a file drag is over the column an overlay marks the target; the state is tracked with a depth counter because `dragenter`/`dragleave` also fire when the cursor crosses child elements. Only drags carrying `Files` arm the zone, so dragging selected text does nothing. Files of an unsupported type are reported via `toast.error` instead of being dropped silently.

## 6) Data Shape

```ts
interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt?: number  // bumped on every appended message; drives the sidebar sort
  messages: StoredMsg[]
}
interface StoredMsg {
  role: 'user' | 'assistant'
  content: string
  useRag?: boolean
  sources?: { file: string; section: string; score: number }[]
  images?: string[]
  attachments?: { name: string; text: string }[]
  feedback?: 'up' | 'down'  // 2026-08-13 — persisted locally, also reported to POST .../chat/feedback
}
```

This is the `localStorage` shape only. The server keeps no chat records; messages are passed in on each request and the server is stateless with respect to the conversation.

## 7) Security Notes

- **No server-side chat history.** The endpoint is stateless; every request carries the full message list. Nothing is persisted to Qdrant or any server store. Sessions live only in the client's `localStorage`.
- **No API keys logged.** The OpenAI `Authorization` header is set on outbound requests only; keys are never written to logs or returned to the client (`embeddingApiKeyConfigured: boolean` is the only key-adjacent field exposed).
- **XSS-safe rendering.** `FormattedChatMessage` builds React nodes directly; it never uses `dangerouslySetInnerHTML`. Inline code, bold, and links are parsed into elements, and the LLM output is always treated as data, not markup.
- Message content is validated server-side (`Array.isArray(messages)` and non-empty) before any LLM call.

## Related Files

- `src/server/routes/chat.ts`
- `src/chat/complete-once.ts`
- `src/server/app.ts`
- `src/config/config.ts`
- `src/config/chat-settings-store.ts`
- `src/retrieval/search.ts`
- `src/retrieval/rag-context.ts`
- `src/retrieval/query-rewrite.ts`
- `src/retrieval/hybrid-search.ts`
- `src/retrieval/bm25.ts`
- `src/retrieval/bm25-index.ts`
- `src/retrieval/rerank.ts`
- `src/history/chat-feedback.ts`
- `src/cli/ask-command.ts` (reuses `rag-context.ts`, see [04-retrieval-search.md](./04-retrieval-search.md))
- `web/src/pages/ai-chat.tsx`
- `web/src/components/formatted-chat-message.tsx`
- `web/src/lib/api-client.ts`

## Cross-References

- Design system: [../design-system/README.md](../design-system/README.md)
- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- API conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
- Extends: [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md)
- Extended by: [10-chat-provider-settings.md](./10-chat-provider-settings.md) (chat's own provider config, independent of embedding)
- Depends on: [04-retrieval-search.md](./04-retrieval-search.md), [07-web-frontend-and-project-cli.md](./07-web-frontend-and-project-cli.md), [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md)