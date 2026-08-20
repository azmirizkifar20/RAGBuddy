# Dashboard Login Auth (Opt-in Access Code Gate)

**Status: Implemented.** An opt-in login screen gating human/browser access to the web dashboard — separate from the API key feature in [12-external-web-app-integration.md](./12-external-web-app-integration.md), which gates programmatic `/api/*` access instead. Off by default (the dashboard stays directly reachable, same as before this feature existed); turned on/off and configured entirely from the Settings page.

## 1) What This Feature Is

1. **Off by default** — no behavior change until an access code is explicitly set from Settings. No environment-variable seed (unlike the API key) — the Settings page is the only way to configure this.
2. **One shared access code**, user-chosen (not generated). Enabling always requires typing a fresh code; it can be changed at any time afterward.
3. **Session-cookie based** — once logged in, a browser stays authenticated via an `HttpOnly` cookie (`ragbuddy_session`, 30-day expiry) rather than re-prompting on every navigation.
4. **A valid API key always bypasses this gate.** If both this feature and the API key feature (`12-external-web-app-integration.md`) are enabled at the same time, a request presenting a valid `Authorization: Bearer <key>` or `X-API-Key` header is treated as authenticated and never needs a session cookie — external integrations keep working unaffected when an admin turns on dashboard login.
5. **No new dependency** — no `cookie-parser`/`express-session`/`jsonwebtoken`. Cookies are parsed/written by hand in `src/server/cookie-utils.ts` (a few lines), consistent with how the CORS middleware was hand-rolled rather than adding a package.
6. **Settings routes that manage this feature are themselves gated** once enabled (or once an API key is configured) — same "no bypass for the endpoints that manage the gate" decision already made for the API key feature, with the same kind of recovery path if you get locked out (see §5).

## 2) Flow / Behavior

```
Browser loads the dashboard (any route)
  → AuthGate (web/src/components/auth-gate.tsx) calls GET /api/auth/status
  → { enabled: false }                → renders the dashboard normally (unchanged default)
  → { enabled: true, authenticated: false } → renders a full-page login screen instead
  → { enabled: true, authenticated: true }  → renders the dashboard normally

Login screen submits POST /api/auth/login { code }
  → right code  → 200 + Set-Cookie: ragbuddy_session=<fresh token>; the app then renders normally
  → wrong code  → 401, inline error shown, stays on the login screen

Every other /api/* request, once enabled
  → dashboardAuthMiddleware (src/server/app.ts)
  → valid API key header?    → allowed (external caller bypass)
  → valid session cookie?    → allowed
  → neither                  → 401 { error: "Login required" }
```

## 3) Routes

| Route | Purpose |
|-------|---------|
| `GET /api/auth/status` | `{ enabled, authenticated }` — always reachable, regardless of gate state (this is how the frontend decides what to render, and how you check without already being logged in). |
| `POST /api/auth/login` | `{ code }` → `200 { ok: true }` + sets the session cookie on a match, `401` otherwise. Always reachable — never itself gated, or logging in would be impossible. |
| `POST /api/auth/logout` | Clears the current browser's session (cookie + server-side token). Always reachable. |
| `GET /api/settings/dashboard-auth` | `{ enabled }` — gated like any other `/api/settings` route once a key/session is required. |
| `POST /api/settings/dashboard-auth/enable` | `{ code }` → turns the gate on and immediately issues a session cookie for the enabling browser, so it isn't locked out of its own change. |
| `POST /api/settings/dashboard-auth/disable` | Turns the gate off, clears the stored code and session. |
| `POST /api/settings/dashboard-auth/change-code` | `{ code }` → updates the code without affecting the current session. |

## 4) Domain

- **`src/config/dashboard-auth-store.ts`** — `DashboardAuthStore`: same shape as `ApiKeyStore` (`src/config/api-key-store.ts`) — a tiny JSON file (`config/dashboard-auth.json`, gitignored), re-read from disk on every call, no in-memory cache, no env seed. `enable(code)`/`disable()`/`changeCode(code)`/`login(code)`/`logout()`/`validateSession(token)`/`isEnabled()`.
- **`src/server/cookie-utils.ts`** — `parseCookies(header)`, `setSessionCookie(res, token)`, `clearSessionCookie(res)`, `SESSION_COOKIE_NAME` — the only cookie handling in the codebase, shared between the login route and the Settings enable route.
- **`src/server/app.ts`** — `dashboardAuthMiddleware(dashboardAuthStore, apiKeyStore)`, mounted at `app.use('/api', ...)` right after `apiKeyMiddleware` and after the `/api/auth` router (which is mounted first and therefore never gated). `extractApiKey(req)` was factored out of `apiKeyMiddleware` so both middlewares share the same bearer/`X-API-Key` extraction logic instead of duplicating it.
- **`src/server/routes/auth.ts`** — `registerAuthRoutes(router, deps)`, mounted at `/api/auth`.
- **`src/server/routes/settings.ts`** — the four `/dashboard-auth*` routes, added alongside the existing `/api-key` routes in `registerSettingsRoutes`.
- **`src/config/config.ts`** — `AppConfig.dashboardAuthStorePath` (default `./config/dashboard-auth.json`, overridable via `DASHBOARD_AUTH_STORE_PATH`). No code/enabled env seed by design.
- **`src/cli/index.ts`** — constructs `DashboardAuthStore` and passes it into `createApp({...})` for the `web` command.

## 5) UI

- **`web/src/components/auth-gate.tsx`** — `AuthGate`, wraps `<AppShell />` at the top of the route tree in `web/src/App.tsx` (the single choke point every route already renders through). Checks `/api/auth/status` once on mount; shows a full-page `Skeleton` while loading, the login screen when required, or `children` (the whole app) otherwise.
- **`web/src/components/login-screen.tsx`** — `LoginScreen`, a full-page form (no sidebar/header chrome — rendered instead of `AppShell`, not inside it) with a password-style access-code input and inline error text on a wrong code.
- **`web/src/pages/settings.tsx`** — `DashboardAuthPanel`, mirrors `ApiAccessPanel`'s structure (state/try-catch/toast pattern) as the settings section directly below it: enable (code input + button), change code, log out (ends just the current browser's session), and disable (behind the same `AlertDialog` confirmation pattern used for removing the API key).
- **`web/src/lib/api-client.ts`** — `getAuthStatus`, `login`, `logout`, `getDashboardAuthStatus`, `enableDashboardAuth`, `disableDashboardAuth`, `changeDashboardAuthCode`.
- No `fetch`-patching needed (unlike the API key's `web/src/lib/api-key.ts`) — the browser attaches cookies to same-origin requests automatically.

## 6) Security Notes

- The access code is stored in plaintext on disk (`config/dashboard-auth.json`) — same trust boundary as `config/api-key.json` and the embedding/chat credential files: local, single-user, not committed (gitignored).
- Session tokens are random (`crypto.randomBytes(24)`), one active token per store (single-admin local tool, consistent with the rest of this app's trust model) — logging in again supersedes any previous session.
- **Locked out?** Delete `config/dashboard-auth.json` on the server (or edit it to `{"enabled": false, "code": null, "sessionToken": null}`) and restart — same recovery pattern as the API key feature's `config/api-key.json`.
- A valid API key bypasses this gate entirely by design (see §1.4) — if you need dashboard login to be the *only* way in, don't also configure an API key.

## Related Files

- `src/config/dashboard-auth-store.ts`
- `src/server/cookie-utils.ts`
- `src/server/app.ts`
- `src/server/routes/auth.ts`
- `src/server/routes/settings.ts`
- `src/config/config.ts`
- `src/cli/index.ts`
- `web/src/components/auth-gate.tsx`
- `web/src/components/login-screen.tsx`
- `web/src/pages/settings.tsx`
- `web/src/lib/api-client.ts`
- `web/src/App.tsx`

## Cross-References

- Interacts with: [12-external-web-app-integration.md](./12-external-web-app-integration.md) — a valid API key bypasses this gate, so enabling dashboard login never breaks an existing external integration.
- Mirrors the pattern of: [10-chat-provider-settings.md](./10-chat-provider-settings.md) §7 (Settings-managed secrets, write-only where applicable, local-trust storage).
- Design system: [../design-system/README.md](../design-system/README.md)
