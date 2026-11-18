import type { SessionStatus } from '@shared/types/session-status'
import type { HiveRelationsPage, HiveSession } from '@/queries/session-hive-contract'
import {
  type HiveNextActorGroup,
  hiveMemberNextActor,
  hiveNextActorGroup,
} from '@/queries/session-hive-next-actor'

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
 * direct Workers are counted by the Hive panel's groups, by who acts next (ADR 0059), so only
 * Workers that need you read in the attention colour. An archived Worker keeps its group:
 * archiving changes only where the panel lists it. Workers are listed 50 per page; `partial`
 * says the counts cover only the pages read so far.
 */
export function hiveSummaryModel(
  pages: readonly HiveRelationsPage[] | undefined,
  statusOf: (sessionId: string) => SessionStatus | undefined = () => undefined,
) {
  const first = pages?.[0]
  const lineage = first?.current?.lineage
  if (!first || !lineage || lineage.role === 'independent') return null
  const workersById = new Map(
    pages?.flatMap((page) => page.workers.map((worker) => [worker.id, worker] as const)),
  )
  const counts: Record<HiveNextActorGroup, number> = {
    'needs-you': 0,
    waiting: 0,
    working: 0,
    closed: 0,
  }
  for (const worker of workersById.values()) {
    if (!isGroupedWorker(worker)) continue
    counts[hiveNextActorGroup(hiveMemberNextActor(worker, statusOf(String(worker.id))))] += 1
  }
  const directCount = Math.max(lineage.directWorkerCount, workersById.size)
  return {
    lineage,
    /** The direct Workers' parent: "waiting for ‹title›". */
    title: first.current?.title ?? 'this Session',
    directCount,
    counts,
    partial: workersById.size < directCount,
  }
}
