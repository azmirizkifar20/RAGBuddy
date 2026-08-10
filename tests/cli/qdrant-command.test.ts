import { describe, it, expect, vi } from 'vitest';
import { runQdrantDropCollection } from '../../src/cli/qdrant-command';

function registryStub(projectIds: string[]) {
  return { list: vi.fn().mockReturnValue(projectIds.map((id) => ({ id }))) } as any;
}

describe('runQdrantDropCollection', () => {
  it('reports affected projects without dropping when not confirmed', async () => {
    const drop = vi.fn();
    const result = await runQdrantDropCollection(false, { registry: registryStub(['a', 'b']), drop });

    expect(result).toEqual({ affectedProjectIds: ['a', 'b'], dropped: false });
    expect(drop).not.toHaveBeenCalled();
  });

  it('drops the collection when confirmed', async () => {
    const drop = vi.fn().mockResolvedValue(undefined);
    const result = await runQdrantDropCollection(true, { registry: registryStub(['a']), drop });

    expect(result).toEqual({ affectedProjectIds: ['a'], dropped: true });
    expect(drop).toHaveBeenCalledTimes(1);
  });
});
