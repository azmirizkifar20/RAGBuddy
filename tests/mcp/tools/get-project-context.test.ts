import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerGetProjectContextTool } from '../../../src/mcp/tools/get-project-context';

describe('get_project_context tool', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-mcp-context-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, '.git'), { recursive: true });
    mkdirSync(path.join(repo, 'docs', 'steering'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function qdrantStub() {
    return {
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      scroll: vi.fn(),
    } as any;
  }

  async function setup(deps: any) {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    registerGetProjectContextTool(server, deps);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it('returns an orientation summary for the project resolved from cwd', async () => {
    writeFileSync(path.join(repo, 'docs', 'steering', 'architecture.md'), '# Architecture\n\nLayered services.\n');
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;

    const client = await setup({
      registry,
      qdrantClient: qdrantStub(),
      qdrantCollection: 'ragbuddy_documents',
      cwd: () => repo,
    });

    const result: any = await client.callTool({ name: 'get_project_context', arguments: {} });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain('Project: Sample (sample)');
    expect(text).toContain('Architecture:');
    expect(text).toContain('Layered services.');
    expect(text).toContain('Recommended next tools:');
  });

  it('supports an explicit project id override', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([]),
      find: vi.fn().mockReturnValue({ id: 'other', name: 'Other', repository: repo, paths: ['docs'] }),
    } as any;

    const client = await setup({
      registry,
      qdrantClient: qdrantStub(),
      qdrantCollection: 'ragbuddy_documents',
      cwd: () => '/somewhere/unrelated',
    });

    const result: any = await client.callTool({ name: 'get_project_context', arguments: { project: 'other' } });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('Project: Other (other)');
  });

  it('returns an MCP error when the project cannot be resolved', async () => {
    const registry = { list: vi.fn().mockReturnValue([]), find: vi.fn() } as any;

    const client = await setup({
      registry,
      qdrantClient: qdrantStub(),
      qdrantCollection: 'ragbuddy_documents',
      cwd: () => '/somewhere/unrelated',
    });

    const result: any = await client.callTool({ name: 'get_project_context', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No registered project found');
  });
});
