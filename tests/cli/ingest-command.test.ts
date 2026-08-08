import { describe, it, expect, vi } from 'vitest';
import { runIngestCommand } from '../../src/cli/ingest-command';

describe('runIngestCommand', () => {
  it('indexes a registered project and returns a combined result', async () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const index = vi.fn().mockResolvedValue({ filesIndexed: 3, chunksIndexed: 9 });

    const result = await runIngestCommand('sample', { registry, index });

    expect(result).toEqual({ filesIndexed: 3, chunksIndexed: 9, projectName: 'Sample' });
    expect(index).toHaveBeenCalledWith({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] });
  });

  it('throws a clear error for an unregistered project', async () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const index = vi.fn();

    await expect(runIngestCommand('missing', { registry, index })).rejects.toThrow('is not registered');
    expect(index).not.toHaveBeenCalled();
  });
});
