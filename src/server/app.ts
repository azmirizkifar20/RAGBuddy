import express, { type Express } from 'express';
import path from 'node:path';
import type { QdrantClient } from '@qdrant/js-client-rest';
import type { ProjectRegistry } from '../projects/project-registry';
import { createEmbeddingProvider, type EmbeddingProvider } from '../embedding/embedding-provider';
import type { SyncHistoryStore } from '../history/sync-history';
import type { ChatFeedbackStore } from '../history/chat-feedback';
import type { CredentialsStore } from '../config/credentials-store';
import type { ApiKeyStore } from '../config/api-key-store';
import type { DashboardAuthStore } from '../config/dashboard-auth-store';
import type { ProjectStatsStore } from '../projects/project-stats';
import { registerProjectsRoutes } from './routes/projects';
import { registerSettingsRoutes, registerCredentialsRoutes, testChatConnection, testEmbeddingConnection } from './routes/settings';
import { registerKnowledgeRoutes } from './routes/knowledge';
import { registerSearchRoutes } from './routes/search';
import { registerChatRoutes } from './routes/chat';
import { registerHookRoutes } from './routes/hook';
import { registerIngestRoutes } from './routes/ingest';
import { registerSyncRoutes } from './routes/sync';
import { registerUploadRoutes } from './routes/uploads';
import { registerHistoryRoutes } from './routes/history';
import { registerFsRoutes } from './routes/fs';
import { registerAuthRoutes } from './routes/auth';
import { parseCookies, SESSION_COOKIE_NAME } from './cookie-utils';

/** Everything the MCP setup page needs to print a copy-pasteable config. Never includes the API key. */
export interface RuntimeInfo {
  nodePath: string;
  cliEntrypoint: string;
  projectRegistryPath: string;
}

export interface AppDeps {
  registry: ProjectRegistry;
  qdrantClient: QdrantClient;
  qdrantUrl: string;
  qdrantCollection: string;
  /** The embedding provider is resolved fresh per use via `resolveEmbeddingProvider(deps)` —
   *  never captured once, since the active credential/model can change without a restart. */
  embeddingCredentials: CredentialsStore;
  ragTopK: number;
  chatCredentials: CredentialsStore;
  chatContextLimit: number;
  staticDir: string;
  /** Optional static landing page served at `/` (mounted before `staticDir`, so its own
   *  `index.html` wins for `/` while SPA assets fall through to `staticDir`). Unset = `/`
   *  serves the SPA shell, matching the pre-landing behavior. */
  landingDir?: string;
  dataDir: string;
  history: SyncHistoryStore;
  runtime: RuntimeInfo;
  /** Cached per-project file/chunk/upload counts for the dashboard list — see `src/projects/project-stats.ts`. */
  statsStore: ProjectStatsStore;
  /** 👍/👎 ratings on chat answers — see `src/history/chat-feedback.ts`. */
  chatFeedback: ChatFeedbackStore;
  /** Origins allowed to call `/api` cross-origin. Empty/undefined = no CORS headers (unchanged
   *  same-origin/localhost behavior). `'*'` allows any origin. */
  allowedOrigins?: string[];
  /** When a key is configured (via Settings or `RAGBUDDY_API_KEY`), every `/api` request must
   *  present it via `Authorization: Bearer <key>` or `X-API-Key`, or get a 401. Unconfigured
   *  (default) = no auth, matching the existing trust model. Resolved fresh per request. */
  apiKeyStore: ApiKeyStore;
  /** When enabled (via Settings only — no env seed), every `/api` request must present either a
   *  valid session cookie (browser login) or a valid API key (external caller bypass). Unconfigured
   *  (default) = no auth, matching the existing trust model. Resolved fresh per request. */
  dashboardAuthStore: DashboardAuthStore;
}

/** Resolves the currently active embedding credential + model into a ready-to-use provider —
 *  called fresh at the start of each operation so a Settings change never needs a restart. */
export function resolveEmbeddingProvider(deps: AppDeps): EmbeddingProvider {
  return createEmbeddingProvider(deps.embeddingCredentials.get());
}

/** No-op when `allowedOrigins` is empty (default) — existing same-origin/localhost behavior is
 *  unchanged. Once set, echoes back the caller's `Origin` when it's allowed (or always, for `'*'`)
 *  and answers preflight `OPTIONS` requests directly instead of letting them fall through to a route. */
function corsMiddleware(allowedOrigins: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (allowedOrigins.length === 0) return next();
    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}

/** No-op when no key is configured (default) — existing no-auth behavior is unchanged. Once one
 *  is, every `/api` request must present it via `Authorization: Bearer <key>` or `X-API-Key`.
 *  Reads `apiKeyStore.get()` fresh per request so a Settings-page change (generate/remove) takes
 *  effect immediately, no restart needed. */
function extractApiKey(req: express.Request): string | string[] | undefined {
  const authHeader = req.headers.authorization;
  const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  return bearer ?? req.headers['x-api-key'];
}

function apiKeyMiddleware(apiKeyStore: ApiKeyStore) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const apiKey = apiKeyStore.get();
    if (!apiKey || req.method === 'OPTIONS') return next();
    if (extractApiKey(req) !== apiKey) {
      res.status(401).json({ error: 'Missing or invalid API key' });
      return;
    }
    next();
  };
}

/** No-op when the dashboard login gate is disabled (default). Once enabled, a request needs
 *  either a valid session cookie (browser login, issued by `/api/auth/login`) or a valid API key
 *  (so external integrations from `docs/features/12-...md` keep working unaffected). */
function dashboardAuthMiddleware(authStore: DashboardAuthStore, apiKeyStore: ApiKeyStore) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authStore.isEnabled() || req.method === 'OPTIONS') return next();
    const apiKey = apiKeyStore.get();
    if (apiKey && extractApiKey(req) === apiKey) return next();
    const cookies = parseCookies(req.headers.cookie);
    if (authStore.validateSession(cookies[SESSION_COOKIE_NAME])) return next();
    res.status(401).json({ error: 'Login required' });
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  // Uploaded documents are posted as JSON (binary formats base64-encoded, so
  // ~1.33x their real size), which makes this limit the real ceiling on
  // document size rather than the 100kb default.
  app.use(express.json({ limit: '32mb' }));
  app.use('/api', corsMiddleware(deps.allowedOrigins ?? []));

  const authRouter = express.Router();
  registerAuthRoutes(authRouter, deps);
  app.use('/api/auth', authRouter); // always reachable — never gated, this IS how you gain access

  app.use('/api', apiKeyMiddleware(deps.apiKeyStore));
  app.use('/api', dashboardAuthMiddleware(deps.dashboardAuthStore, deps.apiKeyStore));

  const apiRouter = express.Router();
  registerProjectsRoutes(apiRouter, deps);
  registerKnowledgeRoutes(apiRouter, deps);
  registerSearchRoutes(apiRouter, deps);
  registerChatRoutes(apiRouter, deps);
  registerHookRoutes(apiRouter, deps);
  registerIngestRoutes(apiRouter, deps);
  registerSyncRoutes(apiRouter, deps);
  registerUploadRoutes(apiRouter, deps);
  registerHistoryRoutes(apiRouter, deps);
  app.use('/api/projects', apiRouter);

  const fsRouter = express.Router();
  registerFsRoutes(fsRouter);
  app.use('/api/fs', fsRouter);

  const settingsRouter = express.Router();
  registerSettingsRoutes(settingsRouter, deps);
  app.use('/api/settings', settingsRouter);

  const embeddingCredsRouter = express.Router();
  registerCredentialsRoutes(embeddingCredsRouter, { store: deps.embeddingCredentials, testConnection: testEmbeddingConnection });
  app.use('/api/settings/embedding', embeddingCredsRouter);

  const chatCredsRouter = express.Router();
  registerCredentialsRoutes(chatCredsRouter, { store: deps.chatCredentials, testConnection: testChatConnection });
  app.use('/api/settings/chat', chatCredsRouter);

  app.get('/api/config', (_req, res) => {
    res.json({
      qdrantUrl: deps.qdrantUrl,
      qdrantCollection: deps.qdrantCollection,
      ragTopK: deps.ragTopK,
      chatContextLimit: deps.chatContextLimit,
      dataDir: deps.dataDir,
      ...deps.runtime,
    });
  });

  app.get('/api/activity', (req, res) => {
    const limit = Number(req.query.limit);
    res.json({ runs: deps.history.list({ limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : 20 }) });
  });

  // The landing page (when present) is mounted first so its `index.html` answers `/` and its
  // `images/`+`fonts/` assets resolve; anything it doesn't have falls through to the SPA bundle.
  if (deps.landingDir) app.use(express.static(deps.landingDir));
  app.use(express.static(deps.staticDir));
  // Express 5 no longer accepts a bare '*' route pattern for a catch-all —
  // a path-less middleware matches everything and sidesteps that entirely.
  app.use((_req, res) => {
    res.sendFile(path.join(deps.staticDir, 'index.html'));
  });

  return app;
}
