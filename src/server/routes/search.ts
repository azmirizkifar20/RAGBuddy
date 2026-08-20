import type { Router } from 'express';
import { type AppDeps, resolveEmbeddingProvider } from '../app';
import { getRagResults } from '../../retrieval/rag-context';
import type { ConversationTurn } from '../../retrieval/query-rewrite';

export function registerSearchRoutes(router: Router, deps: AppDeps): void {
  router.post('/:id/search', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    const query = req.body?.query;
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    // Optional: prior turns let query-rewrite resolve follow-up references ("that", "it") the
    // same way the chat endpoint does — omit it for a one-off, history-free search.
    const history: ConversationTurn[] = Array.isArray(req.body?.history) ? req.body.history : [];
    try {
      // Same rewrite -> hybrid search -> rerank pipeline the chat endpoint uses, so a
      // retrieval-only integration gets the same result quality without needing the chat
      // feature itself. Never throws on its own — a broken/unreachable chat provider just
      // degrades rewrite/rerank to a no-op, falling back to plain hybrid search.
      const { results, error } = await getRagResults(project.id, query, deps.chatCredentials.get(), history, {
        qdrantClient: deps.qdrantClient,
        qdrantCollection: deps.qdrantCollection,
        embeddingProvider: resolveEmbeddingProvider(deps),
        ragTopK: deps.ragTopK,
        bm25VersionKey: deps.statsStore.get(project.id)?.updatedAt ?? '',
      });
      res.json({ results, ...(error ? { error } : {}) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
