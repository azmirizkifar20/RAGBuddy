import { describe, it, expect, vi } from 'vitest';
import { startSse, sendSseEvent } from '../../src/server/sse';

describe('startSse', () => {
  it('sets SSE headers and flushes them', () => {
    const res = { setHeader: vi.fn(), flushHeaders: vi.fn() } as any;

    startSse(res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.flushHeaders).toHaveBeenCalled();
  });
});

describe('sendSseEvent', () => {
  it('writes an event/data pair in SSE wire format', () => {
    const res = { write: vi.fn() } as any;

    sendSseEvent(res, 'log', 'hello world');

    expect(res.write).toHaveBeenCalledWith('event: log\n');
    expect(res.write).toHaveBeenCalledWith('data: "hello world"\n\n');
  });

  it('JSON-serializes object payloads', () => {
    const res = { write: vi.fn() } as any;

    sendSseEvent(res, 'done', { added: ['a.md'] });

    expect(res.write).toHaveBeenCalledWith('data: {"added":["a.md"]}\n\n');
  });
});
