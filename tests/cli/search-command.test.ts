import { describe, it, expect, vi } from 'vitest';
import { runSearchCommand } from '../../src/cli/search-command';

describe('runSearchCommand', () => {
  it('searches a registered project and returns results with project name and query', async () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const search = vi.fn().mockResolvedValue([{ file: 'a.md', section: 'Intro', score: 0.9, content: 'hi' }]);

    const result = await runSearchCommand('sample', 'hello', { registry, search });

    expect(result).toEqual({
      projectName: 'Sample',
      query: 'hello',
      results: [{ file: 'a.md', section: 'Intro', score: 0.9, content: 'hi' }],
    });
    expect(search).toHaveBeenCalledWith(
      { id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] },
      'hello',
    );
  });

  it('throws a clear error for an unregistered project', async () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const search = vi.fn();

    await expect(runSearchCommand('missing', 'hello', { registry, search })).rejects.toThrow(
      'is not registered',
    );
    expect(search).not.toHaveBeenCalled();
  });
});
