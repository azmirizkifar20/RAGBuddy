import { describe, it, expect, vi } from 'vitest';
import { runAskCommand } from '../../src/cli/ask-command';

describe('runAskCommand', () => {
  it('asks a registered project and returns project name, query, answer and sources', async () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const ask = vi.fn().mockResolvedValue({
      answer: 'It syncs on every commit.',
      sources: [{ file: 'docs/a.md', section: 'Sync', score: 0.9 }],
    });

    const result = await runAskCommand('sample', '  how does sync work?  ', { registry, ask });

    expect(result).toEqual({
      projectName: 'Sample',
      query: 'how does sync work?',
      answer: 'It syncs on every commit.',
      sources: [{ file: 'docs/a.md', section: 'Sync', score: 0.9 }],
    });
    expect(ask).toHaveBeenCalledWith(
      { id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] },
      'how does sync work?',
    );
  });

  it('passes through a ragError when retrieval failed but an answer still came back', async () => {
    const registry = {
      find: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;
    const ask = vi.fn().mockResolvedValue({
      answer: 'answered without context',
      sources: [],
      ragError: 'Bad Request',
    });

    const result = await runAskCommand('sample', 'hi', { registry, ask });

    expect(result.ragError).toBe('Bad Request');
  });

  it('throws a clear error for an unregistered project', async () => {
    const registry = { find: vi.fn().mockReturnValue(undefined) } as any;
    const ask = vi.fn();

    await expect(runAskCommand('missing', 'hello', { registry, ask })).rejects.toThrow('is not registered');
    expect(ask).not.toHaveBeenCalled();
  });
});
