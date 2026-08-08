import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectRegistry } from '../../projects/project-registry';
import { resolveProject } from '../../projects/project-resolver';
import { getProjectDocument } from '../document-reader';
import { toolText, toolError } from '../tool-result';

export interface GetProjectDocumentDeps {
  registry: ProjectRegistry;
  cwd: () => string;
  dataDir?: string;
}

export function registerGetProjectDocumentTool(server: McpServer, deps: GetProjectDocumentDeps): void {
  server.registerTool(
    'get_project_document',
    {
      description: 'Return the content of a specific document within a project. Path-traversal-safe.',
      inputSchema: {
        file: z
          .string()
          .describe(
            'Path to the document, relative to the repository root (e.g. docs/steering/architecture.md), or an uploaded document (uploads/notes.md)',
          ),
        project: z
          .string()
          .optional()
          .describe('Explicit project id; if omitted, resolved from the current working directory'),
      },
    },
    async ({ file, project: projectId }) => {
      try {
        const project = resolveProject(deps.registry, deps.cwd(), projectId);
        const content = await getProjectDocument(project, file, { dataDir: deps.dataDir });
        return toolText(content);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
