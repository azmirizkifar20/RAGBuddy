import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

interface ApiKeyFile {
  apiKey: string | null;
}

function isApiKeyFileShape(data: unknown): data is ApiKeyFile {
  if (!data || typeof data !== 'object') return false;
  const value = (data as Record<string, unknown>).apiKey;
  return value === null || typeof value === 'string';
}

/**
 * Single shared secret gating every `/api` request (see `apiKeyMiddleware` in `src/server/app.ts`).
 * Same trust boundary as the embedding/chat `CredentialsStore` files — plaintext on disk, local,
 * single-user. `RAGBUDDY_API_KEY` seeds the initial value on first read only; once the Settings UI
 * generates or removes a key, this file is the source of truth and the env var is ignored.
 */
export class ApiKeyStore {
  constructor(
    private readonly filePath: string,
    private readonly seed?: string,
  ) {}

  private read(): ApiKeyFile {
    if (existsSync(this.filePath)) {
      try {
        const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
        if (isApiKeyFileShape(raw)) return raw;
      } catch {
        // fall through to the seed below
      }
    }
    return { apiKey: this.seed ?? null };
  }

  private write(file: ApiKeyFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2) + '\n', 'utf8');
  }

  /** Resolved fresh per call so a Settings-page change never needs a server restart. */
  get(): string | undefined {
    return this.read().apiKey ?? undefined;
  }

  isConfigured(): boolean {
    return this.get() !== undefined;
  }

  /** Generates and persists a new random key, returned in plaintext once — never retrievable
   *  again afterward (mirrors the write-only API-key convention used by `CredentialsStore`). */
  generate(): string {
    const key = randomBytes(24).toString('hex');
    this.write({ apiKey: key });
    return key;
  }

  /** Clears the key — every `/api` request becomes unauthenticated again. */
  remove(): void {
    this.write({ apiKey: null });
  }
}
