import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

const REGISTRY = () => ({
  list: vi.fn(),
  find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
});

function chatCredentialsDeps(connection: Record<string, unknown>) {
  return {
    get: vi.fn().mockReturnValue(connection),
    list: vi.fn(),
    getRawApiKey: vi.fn(),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    setActive: vi.fn(),
  };
}

/** Base deps for chat tests: ollama provider by default (baseDeps' own chatCredentials default). */
function chatDeps(overrides: Record<string, unknown> = {}): any {
  return baseDeps({
    registry: REGISTRY(),
    ...overrides,
  });
}

/** OpenAI SSE streaming body: one `data:` line per chunk, terminated by [DONE]. */
function openaiStreamBody(chunks: string[]): string {
  return (
    chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') +
    'data: [DONE]\n\n'
  );
}

/** Ollama NDJSON streaming body: one JSON object per line. */
function ollamaStreamBody(chunks: string[]): string {
  return chunks.map((c) => JSON.stringify({ message: { content: c } })).join('\n') + '\n';
}

/** A fetch mock that returns a summarize JSON body for stream:false and a streaming body otherwise. */
function summarizeThenStreamMock(): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, init: any) => {
    const payload = JSON.parse(init.body);
    if (payload.stream === false) {
      return new Response(JSON.stringify({ message: { content: 'summarized context' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(ollamaStreamBody(['ok']), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/projects/:id/chat', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(chatDeps({ registry: { list: vi.fn(), find: vi.fn().mockReturnValue(undefined) } }));

    const res = await request(app).post('/api/projects/missing/chat').send({ messages: [{ role: 'user', content: 'hi' }] });

    expect(res.status).toBe(404);
  });

  it('returns 400 when messages is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(chatDeps());

    const res = await request(app).post('/api/projects/sample/chat').send({ messages: [] });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 when messages is missing', async () => {
    const app = createApp(chatDeps());

    const res = await request(app).post('/api/projects/sample/chat').send({});

    expect(res.status).toBe(400);
  });

  it('streams tokens then done for ollama without RAG', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(ollamaStreamBody(['Hel', 'lo']), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(chatDeps());

    const res = await request(app).post('/api/projects/sample/chat').send({
      useRag: false,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: token\ndata: {"text":"Hel"}');
    expect(res.text).toContain('event: token\ndata: {"text":"lo"}');
    expect(res.text).toContain('event: done');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init.body).model).toBe('llama3');
  });

  it('streams tokens then done for openai without RAG', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(openaiStreamBody(['Hi', ' there']), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(
      chatDeps({
        chatCredentials: chatCredentialsDeps({
          provider: 'openai',
          baseUrl: 'http://localhost:11434',
          model: 'llama3',
          apiKey: 'test-key',
        }),
      }),
    );

    const res = await request(app).post('/api/projects/sample/chat').send({
      useRag: false,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: token\ndata: {"text":"Hi"}');
    expect(res.text).toContain('event: token\ndata: {"text":" there"}');
    expect(res.text).toContain('event: done');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/chat/completions');
    expect(JSON.parse(init.body).model).toBe('llama3');
  });

  it('emits an error frame when the upstream stream rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(chatDeps());

    const res = await request(app).post('/api/projects/sample/chat').send({
      useRag: false,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('boom');
  });

  it('emits sources and passes the retrieved context when useRag is true', async () => {
    // The embedding call now goes through the same fetch as the chat completion (both resolve
    // through resolveEmbeddingProvider/chatCredentials.get(), not an injectable object anymore).
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url.endsWith('/api/embeddings')) {
        return new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200 });
      }
      return new Response(ollamaStreamBody(['answer']), {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const qdrantClient = {
      query: vi.fn().mockResolvedValue({
        points: [{ id: '1', score: 0.9, payload: { file: 'docs/a.md', section: 'Intro', content: 'the secret' } }],
      }),
    };
    const app = createApp(chatDeps({ qdrantClient }));

    const res = await request(app).post('/api/projects/sample/chat').send({
      messages: [{ role: 'user', content: 'what is the secret?' }],
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: sources\ndata: {"sources":[{"file":"docs/a.md","section":"Intro","score":0.9}]}');
    expect(res.text).toContain('event: done');
    const embedCall = fetchMock.mock.calls.find((call: any[]) => call[0].endsWith('/api/embeddings'));
    expect(embedCall?.[1].body).toContain('what is the secret?');
    const chatCall = fetchMock.mock.calls.find((call: any[]) => call[0].endsWith('/api/chat'));
    const payload = JSON.parse(chatCall![1].body);
    const systemContext = payload.messages.find(
      (m: any) => typeof m.content === 'string' && m.content.includes('File: docs/a.md'),
    );
    expect(systemContext).toBeDefined();
    expect(systemContext.content).toContain('the secret');
  });

  it('surfaces a ragError on the sources event when retrieval throws (e.g. embedding dimension mismatch), and still answers', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/embeddings')) {
        return new Response(JSON.stringify({ embedding: [0.1, 0.2] }), { status: 200 });
      }
      return new Response(ollamaStreamBody(['answered without context']), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const qdrantClient = { query: vi.fn().mockRejectedValue(new Error('Bad Request')) };
    const app = createApp(chatDeps({ qdrantClient }));

    const res = await request(app).post('/api/projects/sample/chat').send({
      messages: [{ role: 'user', content: 'what is the secret?' }],
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: sources\ndata: {"sources":[],"ragError":"Bad Request"}');
    expect(res.text).toContain('event: token\ndata: {"text":"answered without context"}');
    expect(res.text).toContain('event: done');
  });

  it('auto-summarizes older messages when they exceed chatContextLimit', async () => {
    const fetchMock = summarizeThenStreamMock();
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(chatDeps({ chatContextLimit: 2 }));

    const res = await request(app).post('/api/projects/sample/chat').send({
      useRag: false,
      messages: [
        { role: 'user', content: 'm1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'm2' },
        { role: 'assistant', content: 'a2' },
        { role: 'user', content: 'm3' },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: done');
    // One summarize (stream:false) call + one streaming call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const summarizeBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(summarizeBody.stream).toBe(false);
    // The streaming payload carries the fabricated summary system message.
    const streamBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const summaryMsg = streamBody.messages.find(
      (m: any) => typeof m.content === 'string' && m.content.startsWith('Summary of earlier conversation:'),
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg.content).toContain('summarized context');
  });
});

describe('POST /api/projects/:id/chat/title', () => {
  it('returns 404 for an unregistered project', async () => {
    const app = createApp(chatDeps({ registry: { list: vi.fn(), find: vi.fn().mockReturnValue(undefined) } }));

    const res = await request(app).post('/api/projects/missing/chat/title').send({ userMessage: 'hi', assistantMessage: 'hello' });

    expect(res.status).toBe(404);
  });

  it('returns 400 when userMessage or assistantMessage is missing', async () => {
    const app = createApp(chatDeps());

    const res = await request(app).post('/api/projects/sample/chat/title').send({ userMessage: 'hi' });

    expect(res.status).toBe(400);
  });

  it('generates a trimmed, unquoted title from a non-streaming completion', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: '"Debugging the Auto-Sync Hook"' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const app = createApp(chatDeps());

    const res = await request(app)
      .post('/api/projects/sample/chat/title')
      .send({ userMessage: 'why does auto-sync fail', assistantMessage: 'because the hook was not installed' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Debugging the Auto-Sync Hook');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(JSON.parse(init.body).stream).toBe(false);
  });

  it('strips markdown emphasis/code markers the model adds despite being told not to', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '***Setup Ollama untuk AI Embedding***' } }), { status: 200 })),
    );
    const app = createApp(chatDeps());

    const res = await request(app)
      .post('/api/projects/sample/chat/title')
      .send({ userMessage: 'how do I set up ollama', assistantMessage: 'pull the model then point EMBEDDING_BASE_URL at it' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Setup Ollama untuk AI Embedding');
  });

  it('returns 500 when the upstream request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const app = createApp(chatDeps());

    const res = await request(app)
      .post('/api/projects/sample/chat/title')
      .send({ userMessage: 'hi', assistantMessage: 'hello' });

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('boom');
  });
});