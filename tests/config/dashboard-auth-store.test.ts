import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DashboardAuthStore } from '../../src/config/dashboard-auth-store';

describe('DashboardAuthStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ragbuddy-dashboard-auth-'));
    filePath = path.join(dir, 'dashboard-auth.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is disabled by default when the file does not exist (no env seed)', () => {
    const store = new DashboardAuthStore(filePath);
    expect(store.isEnabled()).toBe(false);
  });

  it('enable() persists enabled + code, and returns a fresh session token', () => {
    const store = new DashboardAuthStore(filePath);
    const token = store.enable('my-code');

    expect(store.isEnabled()).toBe(true);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(store.validateSession(token)).toBe(true);

    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw).toEqual({ enabled: true, code: 'my-code', sessionToken: token });
  });

  it('disable() resets to disabled, clearing code and session', () => {
    const store = new DashboardAuthStore(filePath);
    const token = store.enable('my-code');
    store.disable();

    expect(store.isEnabled()).toBe(false);
    expect(store.validateSession(token)).toBe(false);
    expect(store.login('my-code')).toBeNull();

    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(raw).toEqual({ enabled: false, code: null, sessionToken: null });
  });

  it('changeCode() updates the code without touching enabled/sessionToken', () => {
    const store = new DashboardAuthStore(filePath);
    const token = store.enable('old-code');
    store.changeCode('new-code');

    expect(store.isEnabled()).toBe(true);
    expect(store.validateSession(token)).toBe(true); // session untouched
    expect(store.login('old-code')).toBeNull();
    expect(store.login('new-code')).not.toBeNull();
  });

  it('login() returns null for a wrong code', () => {
    const store = new DashboardAuthStore(filePath);
    store.enable('right-code');

    expect(store.login('wrong-code')).toBeNull();
  });

  it('login() returns null when disabled, even with a previously-valid code', () => {
    const store = new DashboardAuthStore(filePath);
    store.enable('my-code');
    store.disable();

    expect(store.login('my-code')).toBeNull();
  });

  it('login() with the right code issues a fresh token each time', () => {
    const store = new DashboardAuthStore(filePath);
    store.enable('my-code');

    const first = store.login('my-code');
    const second = store.login('my-code');

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(store.validateSession(first!)).toBe(false); // superseded by the second login
    expect(store.validateSession(second!)).toBe(true);
  });

  it('logout() clears the session token only, leaving enabled/code intact', () => {
    const store = new DashboardAuthStore(filePath);
    const token = store.enable('my-code');
    store.logout();

    expect(store.isEnabled()).toBe(true);
    expect(store.validateSession(token)).toBe(false);
    expect(store.login('my-code')).not.toBeNull(); // still enabled, can log back in
  });

  it('validateSession() is false when disabled, even with a token that was once valid', () => {
    const store = new DashboardAuthStore(filePath);
    const token = store.enable('my-code');
    store.disable();

    expect(store.validateSession(token)).toBe(false);
  });

  it('validateSession() is false for an undefined token', () => {
    const store = new DashboardAuthStore(filePath);
    store.enable('my-code');

    expect(store.validateSession(undefined)).toBe(false);
  });

  it('falls back to disabled/empty when the on-disk file is corrupt JSON', () => {
    writeFileSync(filePath, '{not valid json', 'utf8');
    const store = new DashboardAuthStore(filePath);

    expect(store.isEnabled()).toBe(false);
    expect(store.login('anything')).toBeNull();
  });
});
