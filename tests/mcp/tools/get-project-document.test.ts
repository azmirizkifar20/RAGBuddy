import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerGetProjectDocumentTool } from '../../../src/mcp/tools/get-project-document';

describe('get_project_document tool', () => {
  let dir: string;
  let repo: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-mcp-getdoc-'));
    repo = path.join(dir, 'repo');
    mkdirSync(path.join(repo, 'docs'), { recursive: true });
    writeFileSync(path.join(repo, 'docs', 'architecture.md'), '# Architecture\n');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function setup(deps: any) {
    const server = new McpServer({ name: 'test', version: '0.0.1' });
    registerGetProjectDocumentTool(server, deps);
    const client = new Client({ name: 'test-client', version: '0.0.1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return client;
  }

  it("returns a document's content", async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const client = await setup({ registry, cwd: () => repo });

    const result: any = await client.callTool({
      name: 'get_project_document',
      arguments: { file: 'docs/architecture.md' },
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('# Architecture');
  });

  it('rejects path traversal attempts with an isError result', async () => {
    const registry = {
      list: vi.fn().mockReturnValue([{ id: 'sample', name: 'Sample', repository: repo, paths: ['docs'] }]),
      find: vi.fn(),
    } as any;
    const client = await setup({ registry, cwd: () => repo });

    const result: any = await client.callTool({
      name: 'get_project_document',
      arguments: { file: '../../../etc/passwd' },
    });

    expect(result.isError).toBe(true);
  });
});
