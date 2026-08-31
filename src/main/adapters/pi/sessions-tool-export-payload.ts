import { randomUUID } from 'node:crypto'
import { assertSessionExportBranchSelection } from '@shared/session-export-selection'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import type { SessionsToolParameters } from './sessions-tool-parameters'

type ExportInput = Extract<SessionsToolParameters, { action: 'export' }>

function exportSelection(input: ExportInput) {
  const manifest = input.snapshotManifest
  const branchId = input.branchId ?? manifest?.selectedBranchId ?? undefined
  const includeQueueBodies =
    input.includeQueueBodies ?? (manifest?.queue.bodyScope === 'included' ? true : undefined)
  const branchScope = input.branchScope ?? manifest?.branchScope ?? ('active-branch' as const)
  assertSessionExportBranchSelection({ branchScope, ...(branchId ? { branchId } : {}) })
  return {
    branchScope,
    ...(branchId ? { branchId } : {}),
    ...(includeQueueBodies ? { includeQueueBodies: true } : {}),
  }
}

function exportSnapshot(input: ExportInput) {
  const manifest = input.snapshotManifest
  const throughCreatedOrder = input.throughCreatedOrder ?? manifest?.snapshot.nodeHighWaterMark
  const snapshotStateRevision = input.snapshotStateRevision ?? manifest?.snapshot.stateRevision
  const capturedAt = input.capturedAt ?? manifest?.snapshot.capturedAt
  return {
    ...(throughCreatedOrder === undefined ? {} : { throughCreatedOrder }),
    ...(snapshotStateRevision === undefined ? {} : { snapshotStateRevision }),
    ...(capturedAt === undefined ? {} : { capturedAt }),
    ...(manifest?.snapshot.selectedHeadNodeId
      ? { snapshotHeadNodeId: manifest.snapshot.selectedHeadNodeId }
      : {}),
    ...(manifest === undefined ? {} : { snapshotManifest: manifest }),
  }
}

function exportPagination(input: ExportInput) {
  return {
    limit: input.limit ?? SESSION_QUERY_TRANSCRIPT_LIMIT,
    ...(input.afterCreatedOrder === undefined
      ? {}
      : { afterCreatedOrder: input.afterCreatedOrder }),
  }
}

export function buildSessionsToolExportPayload(input: ExportInput): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'export',
        sessionId: input.sessionId,
        ...exportSelection(input),
        ...exportPagination(input),
        ...exportSnapshot(input),
      },
    },
  }
}
