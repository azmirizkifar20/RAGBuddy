import type { ProjectRegistry } from '../projects/project-registry';

export interface RunQdrantDropCollectionDeps {
  registry: ProjectRegistry;
  drop: () => Promise<void>;
}

export interface RunQdrantDropCollectionResult {
  /** Every registered project's index that will be (or was) lost by the drop. */
  affectedProjectIds: string[];
  dropped: boolean;
}

/** Requires explicit confirmation — dropping the collection wipes every registered project's index. */
export async function runQdrantDropCollection(
  confirmed: boolean,
  deps: RunQdrantDropCollectionDeps,
): Promise<RunQdrantDropCollectionResult> {
  const affectedProjectIds = deps.registry.list().map((p) => p.id);
  if (!confirmed) {
    return { affectedProjectIds, dropped: false };
  }
  await deps.drop();
  return { affectedProjectIds, dropped: true };
}
