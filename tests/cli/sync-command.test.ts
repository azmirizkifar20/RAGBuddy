import { describe, it, expect, vi } from 'vitest';
import { runSyncCommand } from '../../src/cli/sync-command';

describe('runSyncCommand', () => {
  it('syncs a registered project and returns a combined result', async () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const sync = vi.fn().mockResolvedValue({
      added: ['a.md'],
      modified: [],
      deleted: [],
      unchanged: ['b.md'],
    });

    const result = await runSyncCommand('sample', { registry, sync });

    expect(result).toEqual({
      added: ['a.md'],
      modified: [],
      deleted: [],
      unchanged: ['b.md'],
      projectName: 'Sample',
    });
    expect(sync).toHaveBeenCalledWith({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] });
  });

  it('throws a clear error for an unregistered project', async () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const sync = vi.fn();

    await expect(runSyncCommand('missing', { registry, sync })).rejects.toThrow('is not registered');
    expect(sync).not.toHaveBeenCalled();
  });
});
