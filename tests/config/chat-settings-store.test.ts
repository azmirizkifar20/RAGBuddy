import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ChatSettingsStore } from '../../src/config/chat-settings-store';

describe('ChatSettingsStore', () => {
  let dir: string;
  let settingsPath: string;
  const defaults = { provider: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'llama3', apiKey: undefined };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-chat-settings-'));
    settingsPath = path.join(dir, 'chat-settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns the seeded defaults when no override has ever been saved', () => {
    const store = new ChatSettingsStore(settingsPath, defaults);
    expect(store.get()).toEqual(defaults);
    expect(store.getPublic()).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      model: 'llama3',
      apiKeyConfigured: false,
    });
  });

  it('persists a saved override and reflects it on the next get', () => {
    const store = new ChatSettingsStore(settingsPath, defaults);
    store.save({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' });

    expect(store.get()).toEqual({
      provider: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
    });

    const reloaded = new ChatSettingsStore(settingsPath, defaults);
    expect(reloaded.get().baseUrl).toBe('https://proxy.example.com/v1');
  });

  it('never exposes the raw API key from getPublic', () => {
    const store = new ChatSettingsStore(settingsPath, defaults);
    store.save({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' });
    const pub = store.getPublic() as unknown as Record<string, unknown>;
    expect(pub.apiKey).toBeUndefined();
    expect(pub.apiKeyConfigured).toBe(true);
  });

  it('keeps the previously saved API key when a later save omits it', () => {
    const store = new ChatSettingsStore(settingsPath, defaults);
    store.save({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test' });
    store.save({ provider: 'openai', baseUrl: 'https://proxy.example.com/v2', model: 'gpt-4o', apiKey: undefined });

    expect(store.get().apiKey).toBe('sk-test');
    expect(store.get().baseUrl).toBe('https://proxy.example.com/v2');
  });

  it('replaces the API key when a later save provides a new one', () => {
    const store = new ChatSettingsStore(settingsPath, defaults);
    store.save({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-old' });
    store.save({ provider: 'openai', baseUrl: 'https://proxy.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-new' });

    expect(store.get().apiKey).toBe('sk-new');
  });
});
