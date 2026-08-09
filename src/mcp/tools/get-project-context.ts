import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { QdrantClient } from '@qdrant/js-client-rest';
import { z } from 'zod';
import type { ProjectRegistry } from '../../projects/project-registry';
import { resolveProject } from '../../projects/project-resolver';
import { buildProjectContext, type ProjectContextResult } from '../../context/project-context';
import { toolText, toolError } from '../tool-result';

export interface GetProjectContextDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantCollection: string;
  cwd: () => string;
}

const STEERING_LABELS = {
  readme: 'Documentation Overview',
  techStack: 'Tech Stack',
  architecture: 'Architecture',
  systemFlow: 'System Flow',
  apiConventions: 'API Conventions',
} as const;

function formatContext(context: ProjectContextResult): string {
  const lines: string[] = [];
  lines.push(`Project: ${context.project.name} (${context.project.id})`);
  lines.push(`Repository: ${context.repository.name}`);
  lines.push('');

  if (context.git.available) {
    lines.push('Git:');
    lines.push(`- Branch: ${context.git.branch}`);
    lines.push(`- Commit: ${context.git.commit}`);
    lines.push(`- Dirty: ${context.git.dirty ? 'yes' : 'no'}`);
  } else {
    lines.push('Git: unavailable');
  }
  lines.push('');

  if (context.overview) {
    lines.push('Overview:');
    lines.push(context.overview);
    lines.push('');
  }

  for (const [key, label] of Object.entries(STEERING_LABELS) as [keyof typeof STEERING_LABELS, string][]) {
    const summary = context.steering[key];
    if (!summary) continue;
    lines.push(`${label}:`);
    lines.push(summary);
    lines.push('');
  }

  lines.push('Documentation:');
  lines.push(`- Total indexed: ${context.documentation.total}`);
  for (const [category, count] of Object.entries(context.documentation.categories)) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push('');

  if (context.documentation.importantDocuments.length > 0) {
    lines.push('Important documents:');
    for (const doc of context.documentation.importantDocuments) {
      lines.push(`- ${doc}`);
    }
    lines.push('');
  }

  lines.push('Recommended next tools:');
  lines.push('- search_project_docs — deep knowledge retrieval across all indexed documentation');
  lines.push('- get_project_document — read the full content of a specific file');

  return lines.join('\n');
}

export function registerGetProjectContextTool(server: McpServer, deps: GetProjectContextDeps): void {
  server.registerTool(
    'get_project_context',
    {
      description:
        'Return a compact orientation overview of a project — identity, Git status, tech stack/architecture/system-flow summaries, and a documentation inventory. Use this before deeper exploration with search_project_docs or code search; it is not a substitute for either.',
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
        const context = await buildProjectContext(project, {
          qdrantClient: deps.qdrantClient,
          qdrantCollection: deps.qdrantCollection,
        });
        return toolText(formatContext(context));
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
