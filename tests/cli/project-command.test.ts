import { describe, it, expect, vi } from 'vitest';
import { runProjectRegister, runProjectList, runProjectRemove } from '../../src/cli/project-command';

describe('runProjectRegister', () => {
  it('delegates to registry.register with the given input', () => {
    const registry = {
      register: vi.fn().mockReturnValue({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] }),
    } as any;

    const result = runProjectRegister(registry, { id: 'sample', repository: '/r', name: 'Sample', paths: ['docs'] });

    expect(registry.register).toHaveBeenCalledWith('sample', '/r', { name: 'Sample', paths: ['docs'] });
    expect(result).toEqual({ id: 'sample', name: 'Sample', repository: '/r', paths: ['docs'] });
  });

  it('passes undefined name/paths through when not provided', () => {
    const registry = { register: vi.fn().mockReturnValue({ id: 'sample', name: 'sample', repository: '/r', paths: ['docs'] }) } as any;

    runProjectRegister(registry, { id: 'sample', repository: '/r' });

    expect(registry.register).toHaveBeenCalledWith('sample', '/r', { name: undefined, paths: undefined });
  });
});

describe('runProjectList', () => {
  it('delegates to registry.list', () => {
    const registry = { list: vi.fn().mockReturnValue([{ id: 'a', name: 'A', repository: '/a', paths: ['docs'] }]) } as any;

    expect(runProjectList(registry)).toEqual([{ id: 'a', name: 'A', repository: '/a', paths: ['docs'] }]);
    expect(registry.list).toHaveBeenCalled();
  });
});

describe('runProjectRemove', () => {
  it('delegates to registry.remove', () => {
    const registry = { remove: vi.fn() } as any;

    runProjectRemove(registry, 'sample');

    expect(registry.remove).toHaveBeenCalledWith('sample');
  });
});
