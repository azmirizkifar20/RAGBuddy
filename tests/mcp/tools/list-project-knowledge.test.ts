import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerListProjectKnowledgeTool } from '../../../src/mcp/tools/list-project-knowledge';

describe('list_project_knowledge tool', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-mcp-listknow-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function setup(deps: any) {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    registerListProjectKnowledgeTool(server, deps);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it('lists indexed files for the resolved project, sorted', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      scroll: vi.fn().mockResolvedValue({
        points: [
          { id: '1', payload: { file: 'docs/b.md', content_hash: 'h2' } },
          { id: '2', payload: { file: 'docs/a.md', content_hash: 'h1' } },
        ],
        next_page_offset: null,
      }),
    } as any;
    const client = await setup({
      registry,
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      cwd: () => repo,
    });

    const result: any = await client.callTool({ name: 'list_project_knowledge', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe('docs/a.md\ndocs/b.md');
  });

  it('reports when nothing is indexed yet', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const qdrantClient = {
      getCollections: vi.fn().mockResolvedValue({ collections: [{ name: 'ragbuddy_documents' }] }),
      scroll: vi.fn().mockResolvedValue({ points: [], next_page_offset: null }),
    } as any;
    const client = await setup({
      registry,
      qdrantClient,
      qdrantCollection: 'ragbuddy_documents',
      cwd: () => repo,
    });

    const result: any = await client.callTool({ name: 'list_project_knowledge', arguments: {} });

    expect(result.content[0].text).toBe('No documents indexed yet.');
  });
});
