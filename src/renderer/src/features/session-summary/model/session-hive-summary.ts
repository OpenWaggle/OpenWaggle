import type {
  HiveDelegationState,
  HiveRelationsPage,
  HiveSession,
} from '@/queries/session-hive-contract'

export function hiveStateNeedsAttention(state: HiveDelegationState | null | undefined) {
  return state === 'needs_attention' || state === 'revision_requested'
}

function groupHiveWorkers(workers: Iterable<HiveSession>) {
  const activeWorkers: HiveSession[] = []
  const doneWorkers: HiveSession[] = []
  const archivedWorkers: HiveSession[] = []
  let attention = false
  for (const worker of workers) {
    if (worker.archived) {
      archivedWorkers.push(worker)
      continue
    }
    if (
      worker.lineage?.delegationState === 'accepted' ||
      worker.lineage?.delegationState === 'cancelled'
    ) {
      doneWorkers.push(worker)
      continue
    }
    activeWorkers.push(worker)
    attention ||= hiveStateNeedsAttention(worker.lineage?.delegationState)
  }
  return { activeWorkers, doneWorkers, archivedWorkers, attention }
}

export function hiveSummaryModel(pages: readonly HiveRelationsPage[] | undefined) {
  const first = pages?.[0]
  const current = first?.current
  const lineage = current?.lineage
  if (!first || !current || !lineage || lineage.role === 'independent') return null
  const workersById = new Map(
    pages?.flatMap((page) => page.workers.map((worker) => [worker.id, worker] as const)),
  )
  const groups = groupHiveWorkers(workersById.values())
  return {
    current,
    lineage,
    parent: first.parent,
    ...groups,
    activeCount: Math.max(lineage.activeDirectWorkerCount, groups.activeWorkers.length),
    totalCount: Math.max(lineage.directWorkerCount, workersById.size),
    defaultExpanded:
      groups.attention ||
      lineage.activeDirectWorkerCount > 0 ||
      groups.activeWorkers.length > 0 ||
      lineage.role === 'worker',
  }
}
