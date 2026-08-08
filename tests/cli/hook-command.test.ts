import { describe, it, expect, vi } from 'vitest';
import { runHookCommand } from '../../src/cli/hook-command';

describe('runHookCommand', () => {
  it('installs the hook for a registered project', () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const install = vi.fn();
    const uninstall = vi.fn();

    const result = runHookCommand('install', 'sample', { registry, install, uninstall });

    expect(result).toEqual({ action: 'install', projectName: 'Sample' });
    expect(install).toHaveBeenCalledWith('/r', 'sample');
    expect(uninstall).not.toHaveBeenCalled();
  });

  it('uninstalls the hook for a registered project', () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const install = vi.fn();
    const uninstall = vi.fn();

    const result = runHookCommand('uninstall', 'sample', { registry, install, uninstall });

    expect(result).toEqual({ action: 'uninstall', projectName: 'Sample' });
    expect(uninstall).toHaveBeenCalledWith('/r');
    expect(install).not.toHaveBeenCalled();
  });

  it('throws a clear error for an unregistered project', () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const install = vi.fn();
    const uninstall = vi.fn();

    expect(() => runHookCommand('install', 'missing', { registry, install, uninstall })).toThrow(
      'is not registered',
    );
    expect(install).not.toHaveBeenCalled();
  });
});
