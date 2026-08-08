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

describe('scanDocuments — repository root README', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'project-rag-scanner-readme-'));
    mkdirSync(path.join(dir, 'docs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs', 'architecture.md'), '# Architecture');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('always includes the root README.md even though it is outside every configured path', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files).not.toContain('README.md'); // not written yet

    writeFileSync(path.join(dir, 'README.md'), '# Project');
    const withReadme = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(withReadme).toContain('README.md');
    expect(withReadme).toContain('docs/architecture.md');
  });

  it('matches the root README case-insensitively', () => {
    writeFileSync(path.join(dir, 'Readme.MD'), '# Project');
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files).toContain('Readme.MD');
  });

  it('does not add a root README from a nested directory', () => {
    mkdirSync(path.join(dir, 'packages', 'sub'), { recursive: true });
    writeFileSync(path.join(dir, 'packages', 'sub', 'README.md'), '# Sub-package');
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files).not.toContain('packages/sub/README.md');
  });

  it('does nothing when there is no root README', () => {
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files.some((f) => /readme/i.test(f))).toBe(false);
  });

  it('is not duplicated when a configured path already covers the repository root', () => {
    writeFileSync(path.join(dir, 'README.md'), '# Project');
    const files = scanDocuments(dir, ['docs', '.']).map((f) => f.relativePath);
    expect(files.filter((f) => f === 'README.md')).toHaveLength(1);
  });

  it('prefers README.md over README.txt when both exist', () => {
    writeFileSync(path.join(dir, 'README.md'), '# Project');
    writeFileSync(path.join(dir, 'README.txt'), 'Project');
    const files = scanDocuments(dir, ['docs']).map((f) => f.relativePath);
    expect(files).toContain('README.md');
    expect(files).not.toContain('README.txt');
  });
});
