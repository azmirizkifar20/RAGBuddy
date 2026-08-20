import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

interface DashboardAuthFile {
  enabled: boolean;
  code: string | null;
  sessionToken: string | null;
}

function isDashboardAuthFileShape(data: unknown): data is DashboardAuthFile {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.enabled === 'boolean' &&
    (d.code === null || typeof d.code === 'string') &&
    (d.sessionToken === null || typeof d.sessionToken === 'string')
  );
}

const EMPTY: DashboardAuthFile = { enabled: false, code: null, sessionToken: null };

/**
 * Gates human/browser access to the dashboard (see `dashboardAuthMiddleware` in `src/server/app.ts`).
 * Same trust boundary as `ApiKeyStore` — plaintext on disk, local, single-user, no env seed (Settings
 * page is the only way to configure this). Off by default; enabling always requires a fresh code.
 */
export class DashboardAuthStore {
  constructor(private readonly filePath: string) {}

  private read(): DashboardAuthFile {
    if (existsSync(this.filePath)) {
      try {
        const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
        if (isDashboardAuthFileShape(raw)) return raw;
      } catch {
        // fall through to EMPTY below
      }
    }
    return EMPTY;
  }

  private write(file: DashboardAuthFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2) + '\n', 'utf8');
  }

  isEnabled(): boolean {
    return this.read().enabled;
  }

  /** Turns the gate on with a fresh code, and immediately issues a session so the browser that
   *  just enabled it isn't locked out of its own change. Returns the new session token. */
  enable(code: string): string {
    const token = randomBytes(24).toString('hex');
    this.write({ enabled: true, code, sessionToken: token });
    return token;
  }

  disable(): void {
    this.write({ enabled: false, code: null, sessionToken: null });
  }

  changeCode(code: string): void {
    const current = this.read();
    this.write({ ...current, code });
  }

  /** Verifies the code and, on success, issues a fresh session token (invalidating any previous one). */
  login(code: string): string | null {
    const current = this.read();
    if (!current.enabled || !current.code || code !== current.code) return null;
    const token = randomBytes(24).toString('hex');
    this.write({ ...current, sessionToken: token });
    return token;
  }

  logout(): void {
    const current = this.read();
    this.write({ ...current, sessionToken: null });
  }

  validateSession(token: string | undefined): boolean {
    const current = this.read();
    return current.enabled && !!token && !!current.sessionToken && token === current.sessionToken;
  }
}
