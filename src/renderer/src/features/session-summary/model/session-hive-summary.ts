import {
  type HiveDelegationGroup,
  type HiveRelationsPage,
  type HiveSession,
  hiveDelegationGroup,
} from '@/queries/session-hive-contract'

/** A Spawn-lineage Worker; legacy task-runner Workers are not in the Hive panel's groups. */
function isGroupedWorker(worker: HiveSession) {
  return worker.lineage?.historical !== true
}

/**
 * The Session Hub's one-row Hive summary (ADR 0051): the Session's role and the shape of its
 * direct Workers.
 *
 * Every count names its scope (#356): `directCount` is this Session's own Workers, which the
 * sidebar's lineage glyph also counts, while the Hive panel's header counts the whole Hive. The
 * direct Workers are counted by the Hive panel's groups, so a Worker waiting for review is never
 * hidden behind "0 active". An archived Worker keeps its group: archiving changes only where the
 * panel lists it. Workers are listed 50 per page; `partial` says the counts cover only the pages
 * read so far.
 */
export function hiveSummaryModel(pages: readonly HiveRelationsPage[] | undefined) {
  const first = pages?.[0]
  const lineage = first?.current?.lineage
  if (!first || !lineage || lineage.role === 'independent') return null
  const workersById = new Map(
    pages?.flatMap((page) => page.workers.map((worker) => [worker.id, worker] as const)),
  )
  const counts: Record<HiveDelegationGroup, number> = {
    'needs-attention': 0,
    'ready-for-review': 0,
    active: 0,
    closed: 0,
  }
  for (const worker of workersById.values()) {
    if (!isGroupedWorker(worker)) continue
    counts[hiveDelegationGroup(worker.lineage?.delegationState)] += 1
  }
  const directCount = Math.max(lineage.directWorkerCount, workersById.size)
  return {
    lineage,
    directCount,
    counts,
    partial: workersById.size < directCount,
  }
}
