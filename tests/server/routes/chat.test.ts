import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app';
import { baseDeps } from '../test-deps';

const REGISTRY = () => ({
  list: vi.fn(),
  find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
});

function chatSettingsDeps(settings: Record<string, unknown>) {
  return {
    get: vi.fn().mockReturnValue(settings),
    getPublic: vi.fn(),
    save: vi.fn(),
  };
}

/** Base deps for chat tests: ollama provider by default (baseDeps' own chatSettings default). */
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
        chatSettings: chatSettingsDeps({
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
    const fetchMock = vi.fn(async (_url: string, init: any) => {
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
    const embeddingProvider = { embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]), embedDocuments: vi.fn() };
    const app = createApp(chatDeps({ qdrantClient, embeddingProvider }));

    const res = await request(app).post('/api/projects/sample/chat').send({
      messages: [{ role: 'user', content: 'what is the secret?' }],
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('event: sources\ndata: {"sources":[{"file":"docs/a.md","section":"Intro","score":0.9}]}');
    expect(res.text).toContain('event: done');
    expect(embeddingProvider.embedQuery).toHaveBeenCalledWith('what is the secret?');
    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body);
    const systemContext = payload.messages.find(
      (m: any) => typeof m.content === 'string' && m.content.includes('File: docs/a.md'),
    );
    expect(systemContext).toBeDefined();
    expect(systemContext.content).toContain('the secret');
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