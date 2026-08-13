import type { Router } from 'express';
import type { AppDeps } from '../app';
import { getIndexedFiles } from '../../qdrant/qdrant-repository';
import { commitsSince, isStale } from '../../git/doc-staleness';

export function registerKnowledgeRoutes(router: Router, deps: AppDeps): void {
  router.get('/:id/knowledge', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    try {
      const documents = await getIndexedFiles(deps.qdrantClient, deps.qdrantCollection, project.id);

      // Dedupe by commit before shelling out to git — files re-indexed in the same ingest/sync
      // run all share one commit, so this is normally one `git rev-list` call, not one per file.
      const commitsBehindByCommit = new Map<string, number | null>();
      for (const doc of documents) {
        if (doc.gitCommit && !commitsBehindByCommit.has(doc.gitCommit)) {
          commitsBehindByCommit.set(doc.gitCommit, commitsSince(project.repository, doc.gitCommit));
        }
      }
      const withStaleness = documents.map((doc) => {
        const commitsBehind = doc.gitCommit ? (commitsBehindByCommit.get(doc.gitCommit) ?? null) : null;
        return { ...doc, commitsBehind, stale: isStale(commitsBehind) };
      });

      res.json({
        files: withStaleness.map((d) => d.file),
        documents: withStaleness,
        chunkCount: withStaleness.reduce((total, d) => total + d.chunkCount, 0),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
