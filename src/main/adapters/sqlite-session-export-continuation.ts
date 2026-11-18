import type { SessionQueryRequest } from '@shared/types/session-query'

type ExportQuery = Extract<SessionQueryRequest['query'], { operation: 'export' }>

function explicitSnapshotSelectorsMatch(query: ExportQuery) {
  const manifest = query.snapshotManifest
  if (!manifest) return query.afterCreatedOrder === undefined
  return (
    (query.throughCreatedOrder === undefined ||
      manifest.snapshot.nodeHighWaterMark === query.throughCreatedOrder) &&
    (query.snapshotStateRevision === undefined ||
      manifest.snapshot.stateRevision === query.snapshotStateRevision) &&
    (query.capturedAt === undefined || manifest.snapshot.capturedAt === query.capturedAt) &&
    (query.snapshotHeadNodeId === undefined ||
      manifest.snapshot.selectedHeadNodeId === query.snapshotHeadNodeId)
  )
}

export function exportContinuationMatchesSnapshot(input: {
  readonly query: ExportQuery
  readonly branchScope: 'active-branch' | 'tree'
  readonly nodeMutationRevision: number
}) {
  const { query, branchScope, nodeMutationRevision } = input
  const manifest = query.snapshotManifest
  if (!manifest) return explicitSnapshotSelectorsMatch(query)
  return (
    explicitSnapshotSelectorsMatch(query) &&
    manifest.sessionId === query.sessionId &&
    manifest.branchScope === branchScope &&
    manifest.snapshot.nodeMutationRevision !== undefined &&
    manifest.snapshot.nodeMutationRevision === nodeMutationRevision &&
    (branchScope === 'tree' || !query.branchId || manifest.selectedBranchId === query.branchId) &&
    manifest.queue.bodyScope === (query.includeQueueBodies ? 'included' : 'omitted-by-choice')
  )
}
