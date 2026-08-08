import type { QdrantClient } from '@qdrant/js-client-rest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectRegistry } from '../../projects/project-registry';
import { resolveProject } from '../../projects/project-resolver';
import { getIndexedFileHashes } from '../../qdrant/qdrant-repository';
import { toolText, toolError } from '../tool-result';

export interface ListProjectKnowledgeDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantCollection: string;
  cwd: () => string;
}

export function registerListProjectKnowledgeTool(server: McpServer, deps: ListProjectKnowledgeDeps): void {
  server.registerTool(
    'list_project_knowledge',
    {
      description: 'List the documentation files currently indexed for a project.',
      inputSchema: {
        project: z
          .string()
          .optional()
          .describe('Explicit project id; if omitted, resolved from the current working directory'),
      },
    },
    async ({ project: projectId }) => {
      try {
        const project = resolveProject(deps.registry, deps.cwd(), projectId);
        const hashes = await getIndexedFileHashes(deps.qdrantClient, deps.qdrantCollection, project.id);
        const files = [...hashes.keys()].sort();
        return toolText(files.length > 0 ? files.join('\n') : 'No documents indexed yet.');
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
