import type { Router } from 'express';
import type { AppDeps } from '../app';
import { setSessionCookie, clearSessionCookie, parseCookies, SESSION_COOKIE_NAME } from '../cookie-utils';

export function registerAuthRoutes(router: Router, deps: AppDeps): void {
  router.get('/status', (req, res) => {
    const enabled = deps.dashboardAuthStore.isEnabled();
    const cookies = parseCookies(req.headers.cookie);
    const authenticated = !enabled || deps.dashboardAuthStore.validateSession(cookies[SESSION_COOKIE_NAME]);
    res.json({ enabled, authenticated });
  });

  router.post('/login', (req, res) => {
    const code = req.body?.code;
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'code is required' });
      return;
    }
    const token = deps.dashboardAuthStore.login(code);
    if (!token) {
      res.status(401).json({ error: 'Invalid code' });
      return;
    }
    setSessionCookie(res, token);
    res.json({ ok: true });
  });

  router.post('/logout', (_req, res) => {
    deps.dashboardAuthStore.logout();
    clearSessionCookie(res);
    res.status(204).end();
  });
}
