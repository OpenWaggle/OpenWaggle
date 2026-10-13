import {
  type HiveRelationsPage,
  type HiveSession,
  hiveStateNeedsAttention,
} from '@/queries/session-hive-contract'

/** A live Worker the Hive is still waiting on: not archived, historical, done or in review. */
function isActiveWorker(worker: HiveSession) {
  if (worker.archived || worker.lineage?.historical) return false
  const state = worker.lineage?.delegationState
  return state !== 'accepted' && state !== 'cancelled' && state !== 'ready_for_review'
}

/**
 * The Session Hub's one-row Hive summary (ADR 0051): the Session's role and the Hive's shape.
 * Workers themselves are listed only by the Hive panel.
 */
export function hiveSummaryModel(pages: readonly HiveRelationsPage[] | undefined) {
  const first = pages?.[0]
  const lineage = first?.current?.lineage
  if (!first || !lineage || lineage.role === 'independent') return null
  const workersById = new Map(
    pages?.flatMap((page) => page.workers.map((worker) => [worker.id, worker] as const)),
  )
  const activeWorkers = [...workersById.values()].filter(isActiveWorker)
  return {
    lineage,
    activeCount: Math.max(lineage.activeDirectWorkerCount, activeWorkers.length),
    totalCount: Math.max(lineage.directWorkerCount, workersById.size),
    attention: activeWorkers.some((worker) =>
      hiveStateNeedsAttention(worker.lineage?.delegationState),
    ),
  }
}
