import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectConfig } from '../projects/project-types';
import type { SearchResult } from '../retrieval/search';
import { registerSearchProjectDocsTool } from './tools/search-project-docs';
import { registerGetProjectDocumentTool } from './tools/get-project-document';
import { registerListProjectKnowledgeTool } from './tools/list-project-knowledge';

export interface CreateMcpServerDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantCollection: string;
  search: (project: ProjectConfig, query: string) => Promise<SearchResult[]>;
  cwd?: () => string;
}

export function createMcpServer(deps: CreateMcpServerDeps): McpServer {
  const cwd = deps.cwd ?? (() => process.cwd());
  const server = new McpServer({ name: 'project-rag', version: '0.1.0' });

  registerSearchProjectDocsTool(server, { registry: deps.registry, search: deps.search, cwd });
  registerGetProjectDocumentTool(server, { registry: deps.registry, cwd });
  registerListProjectKnowledgeTool(server, {
    registry: deps.registry,
    qdrantClient: deps.qdrantClient,
    qdrantCollection: deps.qdrantCollection,
    cwd,
  });

  return server;
}
