import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerSearchProjectDocsTool } from '../../../src/mcp/tools/search-project-docs';

describe('search_project_docs tool', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-mcp-search-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function setup(deps: any) {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    registerSearchProjectDocsTool(server, deps);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it('resolves the project via cwd and returns search results as JSON text', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const search = vi.fn().mockResolvedValue([{ file: 'a.md', section: 'Intro', score: 0.9, content: 'hi' }]);
    const client = await setup({ registry, search, cwd: () => repo });

    const result: any = await client.callTool({ name: 'search_project_docs', arguments: { query: 'hello' } });

    expect(search).toHaveBeenCalledWith(
      { id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] },
      'hello',
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toEqual([
      { file: 'a.md', section: 'Intro', score: 0.9, content: 'hi' },
    ]);
  });

  it('returns an isError result when the project cannot be resolved', async () => {
    const registry = { list: vi.fn().mockReturnValue([]), find: vi.fn() } as any;
    const search = vi.fn();
    const client = await setup({ registry, search, cwd: () => path.join(dir, 'nowhere') });

    const result: any = await client.callTool({ name: 'search_project_docs', arguments: { query: 'hello' } });

    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });
});
