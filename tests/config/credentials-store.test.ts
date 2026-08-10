import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CredentialsStore, type CredentialSeed } from '../../src/config/credentials-store';

const seed: CredentialSeed = {
  name: 'Default (.env)',
  provider: 'openai',
  baseUrl: 'https://proxy.example.com/v1',
  apiKey: 'sk-seed',
  models: ['gemini-embedding'],
};

describe('CredentialsStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-credentials-'));
    filePath = path.join(dir, 'credentials.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('seeds from the provided default without writing a file until something changes', () => {
    const store = new CredentialsStore(filePath, seed);

    expect(store.get()).toEqual({
      provider: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gemini-embedding',
      apiKey: 'sk-seed',
    });
    expect(existsSync(filePath)).toBe(false);

    const list = store.list();
    expect(list.credentials).toEqual([
      {
        id: 'default',
        name: 'Default (.env)',
        provider: 'openai',
        baseUrl: 'https://proxy.example.com/v1',
        apiKeyConfigured: true,
        models: ['gemini-embedding'],
      },
    ]);
    expect(list.activeCredentialId).toBe('default');
    expect(list.activeModel).toBe('gemini-embedding');
  });

  it('never exposes the raw apiKey in list()', () => {
    const store = new CredentialsStore(filePath, seed);
    for (const c of store.list().credentials) {
      expect((c as any).apiKey).toBeUndefined();
    }
  });

  it('adds a credential, persists it, and keeps the first one active if none was active', () => {
    const store = new CredentialsStore(filePath, { ...seed, apiKey: undefined });
    const added = store.add({ name: 'Local Ollama', provider: 'ollama', baseUrl: 'http://localhost:11434', models: ['bge-m3'] });

    expect(added.name).toBe('Local Ollama');
    expect(added.apiKeyConfigured).toBe(false);
    expect(existsSync(filePath)).toBe(true);

    const list = store.list();
    expect(list.credentials.map((c) => c.name)).toEqual(['Default (.env)', 'Local Ollama']);
  });

  it('activates a different saved credential and model', () => {
    const store = new CredentialsStore(filePath, seed);
    const added = store.add({ name: 'Local Ollama', provider: 'ollama', baseUrl: 'http://localhost:11434', models: ['bge-m3', 'nomic-embed'] });

    store.setActive(added.id, 'nomic-embed');

    expect(store.get()).toEqual({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'nomic-embed', apiKey: undefined });
  });

  it('rejects activating a model that is not one of the credential\'s saved models', () => {
    const store = new CredentialsStore(filePath, seed);
    const added = store.add({ name: 'Local Ollama', provider: 'ollama', baseUrl: 'http://localhost:11434', models: ['bge-m3'] });

    expect(() => store.setActive(added.id, 'not-a-real-model')).toThrow(/not one of/);
  });

  it('keeps the existing apiKey when update omits it, replaces it when a new one is given', () => {
    const store = new CredentialsStore(filePath, seed);
    const added = store.add({ name: 'Local Ollama', provider: 'ollama', baseUrl: 'http://localhost:11434', apiKey: 'sk-old', models: ['bge-m3'] });

    store.update(added.id, { name: 'Local Ollama (renamed)' });
    expect(store.getRawApiKey(added.id)).toBe('sk-old');

    store.update(added.id, { apiKey: 'sk-new' });
    expect(store.getRawApiKey(added.id)).toBe('sk-new');
  });

  it('falls back to another model on the same credential when the active model is removed via update', () => {
    const store = new CredentialsStore(filePath, seed);
    const added = store.add({ name: 'Local Ollama', provider: 'ollama', baseUrl: 'http://localhost:11434', models: ['a', 'b'] });
    store.setActive(added.id, 'b');

    store.update(added.id, { models: ['a'] });

    expect(store.get().model).toBe('a');
  });

  it('falls back to another credential when the active one is removed', () => {
    const store = new CredentialsStore(filePath, seed);
    const added = store.add({ name: 'Local Ollama', provider: 'ollama', baseUrl: 'http://localhost:11434', models: ['bge-m3'] });
    store.setActive(added.id, 'bge-m3');

    store.remove(added.id);

    expect(store.get()).toEqual({
      provider: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gemini-embedding',
      apiKey: 'sk-seed',
    });
  });

  it('throws from get() when no credential is active (e.g. every credential was removed)', () => {
    const store = new CredentialsStore(filePath, seed);
    store.remove('default');

    expect(() => store.get()).toThrow(/no active credential/i);
  });

  it('migrates a legacy flat single-config file (ChatSettingsStore\'s old shape) in place', () => {
    writeFileSync(
      filePath,
      JSON.stringify({ provider: 'openai', baseUrl: 'https://old.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-legacy' }),
    );
    const store = new CredentialsStore(filePath, seed);

    expect(store.get()).toEqual({ provider: 'openai', baseUrl: 'https://old.example.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-legacy' });
    const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(onDisk.credentials).toHaveLength(1);
    expect(onDisk.credentials[0].models).toEqual(['gpt-4o-mini']);
  });
});
