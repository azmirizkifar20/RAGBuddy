import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectRegistry } from '../../projects/project-registry';
import type { ProjectConfig } from '../../projects/project-types';
import type { SearchResult } from '../../retrieval/search';
import { resolveProject } from '../../projects/project-resolver';
import { toolText, toolError } from '../tool-result';

export interface SearchProjectDocsDeps {
  registry: ProjectRegistry;
  search: (project: ProjectConfig, query: string) => Promise<SearchResult[]>;
  cwd: () => string;
}

export function registerSearchProjectDocsTool(server: McpServer, deps: SearchProjectDocsDeps): void {
  server.registerTool(
    'search_project_docs',
    {
      description: "Search a project's indexed documentation for relevant content, scoped to a single project.",
      inputSchema: {
        query: z.string().describe('The search query'),
        project: z
          .string()
          .optional()
          .describe('Explicit project id; if omitted, resolved from the current working directory'),
      },
    },
    async ({ query, project: projectId }) => {
      try {
        const project = resolveProject(deps.registry, deps.cwd(), projectId);
        const results = await deps.search(project, query);
        return toolText(JSON.stringify(results, null, 2));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
