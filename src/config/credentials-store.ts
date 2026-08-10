import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type CredentialProvider = 'ollama' | 'openai';

export interface Credential {
  id: string;
  name: string;
  provider: CredentialProvider;
  baseUrl: string;
  apiKey?: string;
  models: string[];
}

export interface CredentialPublic {
  id: string;
  name: string;
  provider: CredentialProvider;
  baseUrl: string;
  apiKeyConfigured: boolean;
  models: string[];
}

export interface CredentialInput {
  name: string;
  provider: CredentialProvider;
  baseUrl: string;
  /** Blank/omitted on update keeps the currently saved key — write-only in the UI. */
  apiKey?: string;
  models: string[];
}

export interface CredentialSeed extends CredentialInput {}

export interface CredentialsPublic {
  credentials: CredentialPublic[];
  activeCredentialId: string | null;
  activeModel: string | null;
}

/** What ingestion/chat actually need to connect — the active credential's model resolved out. */
export interface ActiveConnection {
  provider: CredentialProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

interface CredentialsFile {
  credentials: Credential[];
  activeCredentialId: string | null;
  activeModel: string | null;
}

/** Stable id for the seeded (.env-derived) credential — never persisted until the user makes an
 *  actual change, so a fresh read always regenerates it identically rather than a random id that
 *  would silently orphan on every re-read. */
const SEED_ID = 'default';

function toPublic(credential: Credential): CredentialPublic {
  const { apiKey, ...rest } = credential;
  return { ...rest, apiKeyConfigured: Boolean(apiKey) };
}

function isCredentialsFileShape(data: unknown): data is CredentialsFile {
  return Boolean(data) && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).credentials);
}

/** The pre-existing single-active-config shape (`ChatSettingsStore`'s file format), migrated
 *  in-place the first time it's read so a prior manual save survives the upgrade. */
interface LegacyFlatSettings {
  provider: CredentialProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

function isLegacyFlatShape(data: unknown): data is LegacyFlatSettings {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return typeof d.provider === 'string' && typeof d.baseUrl === 'string' && typeof d.model === 'string';
}

/**
 * A named list of provider connections ("credentials"), each holding one or more model names,
 * with one (credential, model) pair marked active. Used for both the embedding provider and the
 * chat provider — two independent instances, since their base URL/API key usually come from
 * different sources (`src/config/config.ts`'s `EMBEDDING_*`/chat defaults seed each one).
 */
export class CredentialsStore {
  constructor(
    private readonly filePath: string,
    private readonly seed: CredentialSeed,
  ) {}

  private read(): CredentialsFile {
    if (existsSync(this.filePath)) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      } catch {
        raw = undefined;
      }
      if (isCredentialsFileShape(raw)) return raw;
      if (isLegacyFlatShape(raw)) {
        const migrated = this.buildFile(
          { name: 'Migrated settings', provider: raw.provider, baseUrl: raw.baseUrl, apiKey: raw.apiKey, models: [raw.model] },
          raw.model,
        );
        this.write(migrated);
        return migrated;
      }
    }
    return this.buildFile(this.seed, this.seed.models[0], SEED_ID);
  }

  private buildFile(input: CredentialInput, activeModel: string | undefined, id: string = randomUUID()): CredentialsFile {
    const credential: Credential = { id, ...input };
    return { credentials: [credential], activeCredentialId: credential.id, activeModel: activeModel ?? null };
  }

  private write(file: CredentialsFile): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(file, null, 2) + '\n', 'utf8');
  }

  list(): CredentialsPublic {
    const file = this.read();
    return {
      credentials: file.credentials.map(toPublic),
      activeCredentialId: file.activeCredentialId,
      activeModel: file.activeModel,
    };
  }

  /** Resolves the active credential + model into a ready-to-use connection. */
  get(): ActiveConnection {
    const file = this.read();
    const active = file.credentials.find((c) => c.id === file.activeCredentialId);
    if (!active || !file.activeModel) {
      throw new Error('No active credential configured — add one in Settings.');
    }
    return { provider: active.provider, baseUrl: active.baseUrl, model: file.activeModel, apiKey: active.apiKey };
  }

  /** For a "test connection" call on an already-saved credential without retyping its key. */
  getRawApiKey(id: string): string | undefined {
    return this.read().credentials.find((c) => c.id === id)?.apiKey;
  }

  add(input: CredentialInput): CredentialPublic {
    const file = this.read();
    const credential: Credential = { id: randomUUID(), ...input };
    file.credentials.push(credential);
    if (!file.activeCredentialId) {
      file.activeCredentialId = credential.id;
      file.activeModel = credential.models[0] ?? null;
    }
    this.write(file);
    return toPublic(credential);
  }

  update(id: string, input: Partial<CredentialInput>): CredentialPublic {
    const file = this.read();
    const credential = file.credentials.find((c) => c.id === id);
    if (!credential) throw new Error(`Credential "${id}" not found`);
    if (input.name !== undefined) credential.name = input.name;
    if (input.provider !== undefined) credential.provider = input.provider;
    if (input.baseUrl !== undefined) credential.baseUrl = input.baseUrl;
    if (input.apiKey) credential.apiKey = input.apiKey;
    if (input.models !== undefined) credential.models = input.models;
    if (file.activeCredentialId === id && file.activeModel && !credential.models.includes(file.activeModel)) {
      file.activeModel = credential.models[0] ?? null;
    }
    this.write(file);
    return toPublic(credential);
  }

  remove(id: string): void {
    const file = this.read();
    file.credentials = file.credentials.filter((c) => c.id !== id);
    if (file.activeCredentialId === id) {
      const next = file.credentials[0];
      file.activeCredentialId = next?.id ?? null;
      file.activeModel = next?.models[0] ?? null;
    }
    this.write(file);
  }

  setActive(credentialId: string, model: string): void {
    const file = this.read();
    const credential = file.credentials.find((c) => c.id === credentialId);
    if (!credential) throw new Error(`Credential "${credentialId}" not found`);
    if (!credential.models.includes(model)) {
      throw new Error(`Model "${model}" is not one of this credential's saved models`);
    }
    file.activeCredentialId = credentialId;
    file.activeModel = model;
    this.write(file);
  }
}
