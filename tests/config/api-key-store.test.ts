import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ApiKeyStore } from '../../src/config/api-key-store';

describe('ApiKeyStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-api-key-'));
    filePath = path.join(dir, 'api-key.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is unconfigured when the file does not exist and no seed is given', () => {
    const store = new ApiKeyStore(filePath);
    expect(store.get()).toBeUndefined();
    expect(store.isConfigured()).toBe(false);
  });

  it('seeds from the given value on first read when the file does not exist yet', () => {
    const store = new ApiKeyStore(filePath, 'seeded-key');
    expect(store.get()).toBe('seeded-key');
    expect(store.isConfigured()).toBe(true);
  });

  it('generate() persists a new key and returns it in plaintext', () => {
    const store = new ApiKeyStore(filePath);
    const key = store.generate();
    expect(key).toMatch(/^[0-9a-f]{48}$/);
    expect(store.get()).toBe(key);

    const reloaded = new ApiKeyStore(filePath);
    expect(reloaded.get()).toBe(key);
  });

  it('generate() overrides an env-derived seed once the file exists', () => {
    const store = new ApiKeyStore(filePath, 'seeded-key');
    const generated = store.generate();
    expect(generated).not.toBe('seeded-key');

    const reloaded = new ApiKeyStore(filePath, 'seeded-key');
    expect(reloaded.get()).toBe(generated);
  });

  it('remove() clears a generated key, reverting to unconfigured', () => {
    const store = new ApiKeyStore(filePath);
    store.generate();
    store.remove();
    expect(store.get()).toBeUndefined();

    const reloaded = new ApiKeyStore(filePath, 'seeded-key');
    expect(reloaded.get()).toBeUndefined();
  });

  it('falls back to the seed when the on-disk file is corrupt JSON', () => {
    writeFileSync(filePath, '{not valid json', 'utf8');
    const store = new ApiKeyStore(filePath, 'seeded-key');
    expect(store.get()).toBe('seeded-key');
  });

  it('writes valid, re-readable JSON to disk', () => {
    const store = new ApiKeyStore(filePath);
    const key = store.generate();
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw).toEqual({ apiKey: key });
  });
});
