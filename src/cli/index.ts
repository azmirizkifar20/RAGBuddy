#!/usr/bin/env node
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
// Resolved against this file's own location, not process.cwd() — the git
// post-commit hook invokes this script with cwd set to the TARGET repo
// (e.g. the project being synced), not RAGBuddy's own directory, so a
// cwd-relative .env lookup would silently find nothing there.
loadDotenv({ path: path.resolve(__dirname, '../../.env') });
import { loadConfig } from '../config/config';
import { ProjectRegistry } from '../projects/project-registry';
import { SyncHistoryStore, recordRun, type RunTrigger } from '../history/sync-history';
import { createQdrantClient, dropCollection } from '../qdrant/qdrant-client';
import { createEmbeddingProvider, type EmbeddingProvider } from '../embedding/embedding-provider';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from '../mcp/server';
import { CredentialsStore } from '../config/credentials-store';
import { installHook, uninstallHook } from '../git/hook-installer';
import { runHookCommand } from './hook-command';
import { runProjectRegister, runProjectList, runProjectRemove } from './project-command';
import { createApp } from '../server/app';
import { indexProject } from '../ingestion/indexer';
import { syncProject } from '../ingestion/sync';
import { searchProject } from '../retrieval/search';
import { parseArgs } from './args';
import { runIngestCommand } from './ingest-command';
import { runSyncCommand } from './sync-command';
import { runSearchCommand } from './search-command';
import { runQdrantDropCollection } from './qdrant-command';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === 'unknown') {
    console.error(
      'Usage: ragbuddy <ingest|sync> <project>  |  ragbuddy search <project> "<query>"  |  ragbuddy mcp  |  ' +
        'ragbuddy hook <install|uninstall> <project>  |  ragbuddy qdrant drop-collection --yes',
    );
    process.exitCode = 1;
    return;
  }

  const config = loadConfig();
  const registry = new ProjectRegistry(config.projectRegistryPath);
  const history = new SyncHistoryStore(path.join(config.dataDir, 'sync-history.json'));
  // The post-commit hook shells out to this same CLI; it sets this env var so
  // the history page can tell an automatic sync from one you typed yourself.
  const trigger: RunTrigger = process.env.RAGBUDDY_TRIGGER === 'hook' ? 'hook' : 'cli';
  const qdrantClient = createQdrantClient(config.qdrantUrl);
  // Both stores are seeded from .env on first read and never written to disk until the Settings
  // page (or `ragbuddy qdrant`-style CLI actions) actually saves something — see
  // src/config/credentials-store.ts. Resolved fresh per command below, never captured once, so a
  // Settings change takes effect without restarting a long-running `ragbuddy web`/`ragbuddy mcp`.
  const embeddingCredentials = new CredentialsStore(config.embeddingCredentialsPath, {
    name: 'Default (.env)',
    provider: config.embeddingProvider,
    baseUrl: config.embeddingBaseUrl,
    apiKey: config.embeddingApiKey,
    models: [config.embeddingModel],
  });
  const chatCredentials = new CredentialsStore(config.chatSettingsPath, {
    name: 'Default (.env)',
    provider: config.embeddingProvider,
    baseUrl: config.embeddingBaseUrl,
    apiKey: config.embeddingApiKey,
    models: [config.chatModel],
  });
  const resolveEmbeddingProvider = (): EmbeddingProvider => createEmbeddingProvider(embeddingCredentials.get());
  const onLog = (message: string) => console.log(`[INFO] ${message}`);

  if (parsed.command === 'mcp') {
    const server = createMcpServer({
      registry,
      qdrantClient,
      qdrantCollection: config.qdrantCollection,
      dataDir: config.dataDir,
      search: (project, query) =>
        searchProject(project.id, query, {
          qdrantClient,
          qdrantCollection: config.qdrantCollection,
          embeddingProvider: resolveEmbeddingProvider(),
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
      `[ragbuddy] ${result.action === 'install' ? 'Installed' : 'Uninstalled'} the post-commit hook for "${result.projectName}".`,
    );
    return;
  }

  if (parsed.command === 'project') {
    if (parsed.action === 'list') {
      const projects = runProjectList(registry);
      if (projects.length === 0) {
        console.log('No projects registered.');
      } else {
        for (const p of projects) {
          console.log(`${p.id}\t${p.name}\t${p.repository}\t[${p.paths.join(', ')}]`);
        }
      }
      return;
    }
    if (parsed.action === 'remove') {
      runProjectRemove(registry, parsed.id);
      console.log(`[ragbuddy] Removed project "${parsed.id}" from the registry.`);
      return;
    }
    const project = runProjectRegister(registry, {
      id: parsed.id,
      repository: parsed.repository,
      name: parsed.name,
      paths: parsed.paths,
    });
    console.log(`[ragbuddy] Registered project "${project.id}" (${project.repository}).`);
    return;
  }

  if (parsed.command === 'web') {
    const app = createApp({
      registry,
      qdrantClient,
      qdrantUrl: config.qdrantUrl,
      qdrantCollection: config.qdrantCollection,
      embeddingCredentials,
      ragTopK: config.ragTopK,
      chatCredentials,
      chatContextLimit: config.chatContextLimit,
      staticDir: path.resolve(__dirname, '../../web/dist'),
      dataDir: config.dataDir,
      history,
      runtime: {
        nodePath: process.execPath,
        // Same entrypoint the git hook installer writes into post-commit, so
        // the MCP setup page shows the exact path that already works here.
        cliEntrypoint: path.resolve(__dirname, './index.js'),
        projectRegistryPath: config.projectRegistryPath,
      },
    });
    const port = parsed.port ?? 4300;
    const server = app.listen(port, () => {
      console.log(`[ragbuddy] Web UI running at http://localhost:${port}`);
    });
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(
          `[ragbuddy] Port ${port} is already in use. Stop whatever is using it, or run with --port <other-port>.`,
        );
      } else {
        console.error(`[ragbuddy] Failed to start the web server: ${error.message}`);
      }
      process.exitCode = 1;
    });
    return;
  }

  if (parsed.command === 'ingest') {
    const start = Date.now();
    const result = await runIngestCommand(parsed.projectId, {
      registry,
      index: (project) =>
        recordRun(
          history,
          { project: project.id, kind: 'ingest', trigger },
          () =>
            indexProject(project, {
              qdrantClient,
              qdrantUrl: config.qdrantUrl,
              qdrantCollection: config.qdrantCollection,
              embeddingProvider: resolveEmbeddingProvider(),
              onLog,
            }),
          (r) => ({ filesIndexed: r.filesIndexed, chunksIndexed: r.chunksIndexed }),
        ),
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
        recordRun(
          history,
          { project: project.id, kind: 'sync', trigger },
          () =>
            syncProject(project, {
              qdrantClient,
              qdrantUrl: config.qdrantUrl,
              qdrantCollection: config.qdrantCollection,
              embeddingProvider: resolveEmbeddingProvider(),
              onLog,
            }),
          (r) => ({
            added: r.added.length,
            modified: r.modified.length,
            deleted: r.deleted.length,
            unchanged: r.unchanged.length,
          }),
        ),
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

  if (parsed.command === 'qdrant') {
    const result = await runQdrantDropCollection(parsed.confirmed, {
      registry,
      drop: () => dropCollection(qdrantClient, config.qdrantCollection),
    });
    console.log(`This will permanently delete the Qdrant collection "${config.qdrantCollection}".`);
    if (result.affectedProjectIds.length > 0) {
      console.log('Every registered project below loses its index and must be re-ingested:');
      for (const id of result.affectedProjectIds) console.log(`  - ${id}`);
    }
    if (!result.dropped) {
      console.log('\nRe-run with --yes to actually drop it: ragbuddy qdrant drop-collection --yes');
      process.exitCode = 1;
      return;
    }
    console.log(`\n[ragbuddy] Dropped collection "${config.qdrantCollection}".`);
    console.log('Run "ragbuddy ingest <project>" for each project above to rebuild it at the new dimension.');
    return;
  }

  const result = await runSearchCommand(parsed.projectId, parsed.query, {
    registry,
    search: (project, query) =>
      searchProject(project.id, query, {
        qdrantClient,
        qdrantCollection: config.qdrantCollection,
        embeddingProvider: resolveEmbeddingProvider(),
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
  console.error(`[ragbuddy] Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
