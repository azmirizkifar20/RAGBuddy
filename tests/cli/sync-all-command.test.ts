import { describe, it, expect, vi } from 'vitest';
import { runSyncAllCommand } from '../../src/cli/sync-all-command';

const PROJECT_A = { id: 'a', name: 'A', repository: '/a', paths: ['docs'] };
const PROJECT_B = { id: 'b', name: 'B', repository: '/b', paths: ['docs'] };

describe('runSyncAllCommand', () => {
  it('returns an empty array when no projects are registered', async () => {
    const registry = { list: vi.fn().mockReturnValue([]) } as any;
    const sync = vi.fn();

    expect(await runSyncAllCommand({ registry, sync })).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs every registered project and reports a success result per project', async () => {
    const registry = { list: vi.fn().mockReturnValue([PROJECT_A, PROJECT_B]) } as any;
    const sync = vi
      .fn()
      .mockResolvedValueOnce({ added: ['x.md'], modified: [], deleted: [], unchanged: [] })
      .mockResolvedValueOnce({ added: [], modified: ['y.md'], deleted: [], unchanged: [] });

    const results = await runSyncAllCommand({ registry, sync });

    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenNthCalledWith(1, PROJECT_A);
    expect(sync).toHaveBeenNthCalledWith(2, PROJECT_B);
    expect(results).toEqual([
      { projectId: 'a', projectName: 'A', status: 'success', result: { added: ['x.md'], modified: [], deleted: [], unchanged: [] } },
      { projectId: 'b', projectName: 'B', status: 'success', result: { added: [], modified: ['y.md'], deleted: [], unchanged: [] } },
    ]);
  });

  it("isolates one project's failure — it never stops the rest from syncing", async () => {
    const registry = { list: vi.fn().mockReturnValue([PROJECT_A, PROJECT_B]) } as any;
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new Error('Qdrant unreachable'))
      .mockResolvedValueOnce({ added: [], modified: [], deleted: [], unchanged: ['z.md'] });

    const results = await runSyncAllCommand({ registry, sync });

    expect(sync).toHaveBeenCalledTimes(2);
    expect(results[0]).toEqual({ projectId: 'a', projectName: 'A', status: 'error', error: 'Qdrant unreachable' });
    expect(results[1]).toEqual({
      projectId: 'b',
      projectName: 'B',
      status: 'success',
      result: { added: [], modified: [], deleted: [], unchanged: ['z.md'] },
    });
  });
});
