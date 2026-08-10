import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type ChatProvider = 'ollama' | 'openai';

export interface ChatSettings {
  provider: ChatProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface ChatSettingsUpdate {
  provider: ChatProvider;
  baseUrl: string;
  model: string;
  /** Blank/omitted means "keep the currently saved key" — the field is write-only in the UI. */
  apiKey?: string;
}

export interface ChatSettingsPublic {
  provider: ChatProvider;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

/**
 * Chat's own base URL / provider / model / API key, independent of the
 * embedding provider used for RAG. Seeded from `.env`-derived defaults (the
 * pre-existing behavior, where chat mirrored embedding config) until the
 * Settings page saves an override here — so nobody who hasn't touched this
 * feature sees any change.
 */
export class ChatSettingsStore {
  constructor(
    private readonly settingsPath: string,
    private readonly defaults: ChatSettings,
  ) {}

  get(): ChatSettings {
    if (!existsSync(this.settingsPath)) {
      return this.defaults;
    }
    const stored = JSON.parse(readFileSync(this.settingsPath, 'utf8')) as Partial<ChatSettings>;
    return { ...this.defaults, ...stored };
  }

  getPublic(): ChatSettingsPublic {
    const { apiKey, ...rest } = this.get();
    return { ...rest, apiKeyConfigured: Boolean(apiKey) };
  }

  save(update: ChatSettingsUpdate): void {
    const current = this.get();
    const next: ChatSettings = {
      provider: update.provider,
      baseUrl: update.baseUrl,
      model: update.model,
      apiKey: update.apiKey ? update.apiKey : current.apiKey,
    };
    mkdirSync(path.dirname(this.settingsPath), { recursive: true });
    writeFileSync(this.settingsPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
  }
}
