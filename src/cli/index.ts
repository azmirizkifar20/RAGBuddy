#!/usr/bin/env node
import { loadConfig } from '../config/config';
import { ProjectRegistry } from '../projects/project-registry';
import { createQdrantClient } from '../qdrant/qdrant-client';
import { createEmbeddingProvider } from '../embedding/embedding-provider';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../mcp/server';
import { installHook, uninstallHook } from '../git/hook-installer';
import { runHookCommand } from './hook-command';
import { indexProject } from '../ingestion/indexer';
import { syncProject } from '../ingestion/sync';
import { searchProject } from '../retrieval/search';
import { parseArgs } from './args';
import { runIngestCommand } from './ingest-command';
import { runSyncCommand } from './sync-command';
import { runSearchCommand } from './search-command';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === 'unknown') {
    console.error(
      'Usage: project-rag <ingest|sync> <project>  |  project-rag search <project> "<query>"  |  project-rag mcp  |  project-rag hook <install|uninstall> <project>',
    );
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const registry = new ProjectRegistry(config.projectRegistryPath);
  const qdrantClient = createQdrantClient(config.qdrantUrl);
  const embeddingProvider = createEmbeddingProvider({
    provider: config.embeddingProvider,
    baseUrl: config.embeddingBaseUrl,
    model: config.embeddingModel,
    apiKey: config.embeddingApiKey,
  });
  const onLog = (message: string) => console.log(`[INFO] ${message}`);

  if (parsed.command === 'mcp') {
    const server = createMcpServer({
      registry,
      qdrantClient,
      qdrantCollection: config.qdrantCollection,
      search: (project, query) =>
        searchProject(project.id, query, {
          qdrantClient,
          qdrantCollection: config.qdrantCollection,
          embeddingProvider,
          topK: config.ragTopK,
        }),
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }

  if (parsed.command === 'hook') {
    const result = runHookCommand(parsed.action, parsed.projectId, {
      registry,
      install: installHook,
      uninstall: uninstallHook,
    });
    console.log(
      `[project-rag] ${result.action === 'install' ? 'Installed' : 'Uninstalled'} the post-commit hook for "${result.projectName}".`,
    );
    return;
  }

  if (parsed.command === 'ingest') {
    const start = Date.now();
    const result = await runIngestCommand(parsed.projectId, {
      registry,
      index: (project) =>
        indexProject(project, {
          qdrantClient,
          qdrantUrl: config.qdrantUrl,
          qdrantCollection: config.qdrantCollection,
          embeddingProvider,
          onLog,
        }),
    });
    const durationSeconds = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`Project: ${result.projectName}\n`);
    console.log('Indexed:');
    console.log(`  ${result.filesIndexed} files`);
    console.log(`  ${result.chunksIndexed} chunks\n`);
    console.log(`Ingest completed in ${durationSeconds}s`);
    return;
  }

  if (parsed.command === 'sync') {
    const start = Date.now();
    const result = await runSyncCommand(parsed.projectId, {
      registry,
      sync: (project) =>
        syncProject(project, {
          qdrantClient,
          qdrantUrl: config.qdrantUrl,
          qdrantCollection: config.qdrantCollection,
          embeddingProvider,
          onLog,
        }),
    });
    const durationSeconds = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`Project: ${result.projectName}\n`);
    if (result.added.length > 0) {
      console.log('Added:');
      for (const file of result.added) console.log(`  ${file}`);
      console.log('');
    }
    if (result.modified.length > 0) {
      console.log('Modified:');
      for (const file of result.modified) console.log(`  ${file}`);
      console.log('');
    }
    if (result.deleted.length > 0) {
      console.log('Deleted:');
      for (const file of result.deleted) console.log(`  ${file}`);
      console.log('');
    }
    if (result.unchanged.length > 0) {
      console.log('Skipped:');
      for (const file of result.unchanged) console.log(`  ${file}`);
      console.log('');
    }
    console.log('Summary:');
    console.log(`  Added: ${result.added.length}`);
    console.log(`  Modified: ${result.modified.length}`);
    console.log(`  Deleted: ${result.deleted.length}`);
    console.log(`  Unchanged: ${result.unchanged.length}\n`);
    console.log(`Sync completed in ${durationSeconds}s`);
    return;
  }

  const result = await runSearchCommand(parsed.projectId, parsed.query, {
    registry,
    search: (project, query) =>
      searchProject(project.id, query, {
        qdrantClient,
        qdrantCollection: config.qdrantCollection,
        embeddingProvider,
        topK: config.ragTopK,
      }),
  });

  console.log(`Project: ${result.projectName}`);
  console.log(`Query: "${result.query}"\n`);
  if (result.results.length === 0) {
    console.log('No results found.');
    return;
  }
  result.results.forEach((r, i) => {
    console.log(`${i + 1}. [${r.score.toFixed(4)}] ${r.file} — ${r.section}`);
    console.log(`   ${r.content}\n`);
  });
}

main().catch((error) => {
  console.error(`[project-rag] Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
