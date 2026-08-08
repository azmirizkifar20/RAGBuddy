#!/usr/bin/env node
import { loadConfig } from '../config/config';
import { ProjectRegistry } from '../projects/project-registry';
import { createQdrantClient } from '../qdrant/qdrant-client';
import { createEmbeddingProvider } from '../embedding/embedding-provider';
import { indexProject } from '../ingestion/indexer';
import { parseArgs } from './args';
import { runIngestCommand } from './ingest-command';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command !== 'ingest') {
    console.error('Usage: project-rag ingest <project>');
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

  const start = Date.now();
  const result = await runIngestCommand(parsed.projectId, {
    registry,
    index: (project) =>
      indexProject(project, {
        qdrantClient,
        qdrantUrl: config.qdrantUrl,
        qdrantCollection: config.qdrantCollection,
        embeddingProvider,
        onLog: (message) => console.log(`[INFO] ${message}`),
      }),
  });
  const durationSeconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`Project: ${result.projectName}\n`);
  console.log('Indexed:');
  console.log(`  ${result.filesIndexed} files`);
  console.log(`  ${result.chunksIndexed} chunks\n`);
  console.log(`Ingest completed in ${durationSeconds}s`);
}

main().catch((error) => {
  console.error(`[project-rag] Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
