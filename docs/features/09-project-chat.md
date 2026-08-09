# Per-Project Chat

**Status: Implemented**. Adds a streaming chat interface to the dashboard (extends [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md)). Chat lives at its own top-level sidebar page (`/chat`), not nested under a project's detail tabs — but every chat is still scoped to one project: starting a new chat requires picking a project first (a picker screen at `/chat` with no project selected), and once picked (`/chat/:projectId`) you can ask questions grounded in that project's indexed documents, toggle retrieval on or off, attach files, and keep multiple sessions. No chat history is stored on the server; every session lives in the browser's `localStorage`, keyed per project, so moving the page didn't lose or migrate any existing session.

## 1) What This Feature Is

1. **Streaming chat per project** — a `POST /api/projects/:id/chat` endpoint that streams the model's reply token-by-token over SSE, with optional RAG grounding.
2. **Multi-session, client-persisted** — any number of named chat sessions per project, stored in `localStorage` under `project-rag:chats:${projectId}`. Nothing chat-related is written to the server or Qdrant.
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
      → optional RAG: embed last user text → searchProject(project.id, topK)
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

`useRag` defaults to `true` (`body.useRag !== false`). When enabled, the server takes the last user message's text, embeds it, and runs `searchProject` with the project filter and `topK = RAG_TOP_K`. If any chunks come back, they are joined into a `system` message: `Use these project documents to answer. If the answer is not in them say you don't know.` When disabled, the message is sent without any retrieval. A RAG failure is caught and the conversation continues without context.

### Provider routing

The provider is derived from `EMBEDDING_PROVIDER` at runtime (`deps.runtime.embeddingProvider`). OpenAI hits `${embeddingBaseUrl}/chat/completions` with `Authorization: Bearer ${embeddingApiKey}`; Ollama hits `${embeddingBaseUrl}/api/chat`. Images ride the request as `image_url` parts for OpenAI and as an `images` array for Ollama.

## 3) Routes

| Route | Purpose |
|-------|---------|
| `POST /api/projects/:id/chat` | Streaming chat for one project. 404 if the project is not registered, 400 if `messages` is empty or not an array |

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

- **`src/server/routes/chat.ts`** — `registerChatRoutes`; the endpoint, auto-compaction, RAG injection, provider routing, and the OpenAI/Ollama streaming paths. Helpers `flattenContent`, `lastUserText`, `toProviderMessages`, `summarize`.
- **`src/server/app.ts`** — mounts the chat router at `/api/projects`, threads `chatModel` / `chatContextLimit` through `AppDeps` and the runtime config endpoint.
- **`src/config/config.ts`** — `chatModel` (default `gpt-4o-mini` for OpenAI, `llama3` for Ollama) and `chatContextLimit` (default `10`), validated against `CHAT_MODEL` / `CHAT_CONTEXT_LIMIT`.
- **`src/retrieval/search.ts`** — the same project-filtered topK search an agent hits; reused for RAG grounding.

## 5) UI

- **`web/src/pages/ai-chat.tsx`** — the top-level chat page, rendered for both `/chat` and `/chat/:projectId` (`web/src/App.tsx`), sidebar entry "AI Chat" (`web/src/components/layout/sidebar.tsx`).
  - `/chat` (no `projectId`) — a project picker: a centered heading, then a card per registered project (from `useProjects()`) linking to `/chat/:projectId`. Each card's subtitle ("N saved chat(s)" / "No chats yet") is read directly from that project's `localStorage` key, so returning users can see their history is intact before clicking in.
  - `/chat/:projectId` — fetches the project via `getProject(id)` (the same call `ProjectLayout` makes, just done locally instead of through `useProjectContext()`, since this page is not nested under `ProjectLayout`) and then renders the chat room: session list, active session, message list, input, Use RAG toggle, Stop button, attachments, starter prompts, streaming dots, source chips.
  - The old `/projects/:id/chat` tab and route are gone — `ProjectLayout`'s `TABS` no longer lists a Chat entry.
- **`web/src/components/formatted-chat-message.tsx`** — custom renderer: `splitBlocks` parses fenced code, `|`-tables, and paragraphs; `renderInline` turns inline code, bold, and links into React nodes. Tables are wrapped in a scrollable container with striped rows; code blocks are collapsible with a copy button; nothing is injected as raw HTML.
- **`web/src/lib/api-client.ts`** — `streamProjectChat` reads the SSE body, splits frames on blank lines, and dispatches `token` / `sources` / `error` / `done` to handlers. It aborts cleanly when the caller's `AbortSignal` fires.

### Multi-session behavior

- Persistence: `localStorage`, key `project-rag:chats:${projectId}`, value `{ sessions, activeId }`. Loaded on mount, written on every change. Corrupt storage is ignored and the UI starts fresh.
- Sessions: `new` (random UUID id, title `New chat`), `rename`, `delete`, and `switch`. If no sessions exist, one is created automatically.
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
  messages: StoredMsg[]
}
interface StoredMsg {
  role: 'user' | 'assistant'
  content: string
  useRag?: boolean
  sources?: { file: string; section: string; score: number }[]
  images?: string[]
  attachments?: { name: string; text: string }[]
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
- `src/server/app.ts`
- `src/config/config.ts`
- `src/retrieval/search.ts`
- `web/src/pages/ai-chat.tsx`
- `web/src/components/formatted-chat-message.tsx`
- `web/src/lib/api-client.ts`

## Cross-References

- Design system: [../design-system/README.md](../design-system/README.md)
- System flow: [../steering/system-flow.md](../steering/system-flow.md)
- Architecture: [../steering/architecture.md](../steering/architecture.md)
- API conventions: [../steering/api-conventions.md](../steering/api-conventions.md)
- Extends: [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md)
- Depends on: [04-retrieval-search.md](./04-retrieval-search.md), [07-web-frontend-and-project-cli.md](./07-web-frontend-and-project-cli.md), [08-dashboard-redesign-uploads-and-history.md](./08-dashboard-redesign-uploads-and-history.md)