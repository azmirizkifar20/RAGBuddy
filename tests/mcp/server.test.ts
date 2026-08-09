import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/mcp/server';

describe('createMcpServer', () => {
  it('registers all four tools', async () => {
    const registry = { list: vi.fn().mockReturnValue([]), find: vi.fn() } as any;
    const qdrantClient = {} as any;
    const server = createMcpServer({
      registry,
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      search: vi.fn(),
    });

    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();

    expect(names).toEqual([
      'get_project_context',
      'get_project_document',
      'list_project_knowledge',
      'search_project_docs',
    ]);
  });
});
