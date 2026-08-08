import type { Router } from 'express';
import type { AppDeps } from '../app';
import { listUploads, uploadDocument, removeUpload } from '../../ingestion/uploads';
import { recordRun } from '../../history/sync-history';

export function registerUploadRoutes(router: Router, deps: AppDeps): void {
  router.get('/:id/uploads', (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    res.json({ uploads: listUploads(deps.dataDir, project.id) });
  });

  router.post('/:id/uploads', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    // Binary formats (PDF/Word/Excel) arrive base64-encoded in `data`; plain
    // text may use `content` directly. Base64-in-JSON keeps one code path and
    // avoids a multipart dependency for what is a localhost-only upload.
    const { filename, content, data } = req.body ?? {};
    if (typeof filename !== 'string' || (typeof content !== 'string' && typeof data !== 'string')) {
      res.status(400).json({ error: 'filename and content (or data) are required' });
      return;
    }
    try {
      const result = await recordRun(
        deps.history,
        { project: project.id, kind: 'upload', trigger: 'web' },
        () =>
          uploadDocument(
            project,
            typeof data === 'string' ? { filename, data: Buffer.from(data, 'base64') } : { filename, content },
            {
              qdrantClient: deps.qdrantClient,
              qdrantUrl: deps.qdrantUrl,
              qdrantCollection: deps.qdrantCollection,
              embeddingProvider: deps.embeddingProvider,
              dataDir: deps.dataDir,
            },
          ),
        (r) => ({
          file: r.file,
          type: r.documentType,
          chunksIndexed: r.chunksIndexed,
          replaced: r.replaced,
          truncated: r.truncated,
        }),
      );
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/:id/uploads/:filename', async (req, res) => {
    const project = deps.registry.find(req.params.id);
    if (!project) {
      res.status(404).json({ error: `Project "${req.params.id}" is not registered` });
      return;
    }
    try {
      await recordRun(
        deps.history,
        { project: project.id, kind: 'upload-remove', trigger: 'web' },
        async () => {
          await removeUpload(project, req.params.filename, {
            qdrantClient: deps.qdrantClient,
            qdrantCollection: deps.qdrantCollection,
            dataDir: deps.dataDir,
          });
          return { file: req.params.filename };
        },
        (r) => ({ file: r.file }),
      );
      res.status(204).end();
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
