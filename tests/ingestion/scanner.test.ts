import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanDocuments } from '../../src/ingestion/scanner';

describe('scanDocuments', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-scanner-'));
    mkdirSync(path.join(dir, 'docs', 'steering'), { recursive: true });
    mkdirSync(path.join(dir, 'docs', 'node_modules'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'README.md'), '# Readme');
    writeFileSync(path.join(dir, 'docs', 'steering', 'architecture.md'), '# Architecture');
    writeFileSync(path.join(dir, 'docs', 'node_modules', 'ignored.md'), '# Ignored');
    writeFileSync(path.join(dir, 'docs', '.env'), 'SECRET=1');
    writeFileSync(path.join(dir, 'docs', 'logo.png'), 'binary');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds markdown files under configured paths', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath).sort();
    expect(files).toContain('docs/README.md');
    expect(files).toContain('docs/steering/architecture.md');
  });

  it('ignores excluded directories', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files).not.toContain('docs/node_modules/ignored.md');
  });

  it('ignores .env files', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files.some((f) => f.endsWith('.env'))).toBe(false);
  });

  it('ignores unsupported file extensions', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files.some((f) => f.endsWith('.png'))).toBe(false);
  });

  it('rejects configured paths that escape the repository root', () => {
    expect(() => scanDocuments(dir, ['../outside'])).toThrow();
  });

  it('rejects absolute configured paths outside the repository root', () => {
    const outside = path.join(tmpdir(), 'project-rag-scanner-outside-target');
    expect(() => scanDocuments(dir, [outside])).toThrow();
  });
});
