import type { ProjectRegistry } from '../projects/project-registry';
import type { ProjectStatsStore } from '../projects/project-stats';

export interface RunQdrantDropCollectionDeps {
  registry: ProjectRegistry;
  drop: () => Promise<void>;
  /** Optional — when provided, every affected project's cached dashboard stats are cleared so
   *  the next page load doesn't keep showing counts from the collection that was just dropped. */
  statsStore?: ProjectStatsStore;
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
  for (const id of affectedProjectIds) deps.statsStore?.remove(id);
  return { affectedProjectIds, dropped: true };
}
