import { randomUUID } from 'node:crypto'
import { assertSessionExportBranchSelection } from '@shared/session-export-selection'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import type { SessionsToolParameters } from './sessions-tool-parameters'

type ExportInput = Extract<SessionsToolParameters, { action: 'export' }>

function assertManifestTarget(input: ExportInput) {
  const manifest = input.snapshotManifest
  if (!manifest) return
  if (manifest.sessionId !== input.sessionId) {
    throw new Error('The export snapshot manifest belongs to a different Session.')
  }
  if (input.branchScope && input.branchScope !== manifest.branchScope) {
    throw new Error('The export scope must match the snapshot manifest.')
  }
  if (input.branchId && input.branchId !== manifest.selectedBranchId) {
    throw new Error('The export branch must match the snapshot manifest.')
  }
  if (
    input.includeQueueBodies !== undefined &&
    input.includeQueueBodies !== (manifest.queue.bodyScope === 'included')
  ) {
    throw new Error('The export queue-body scope must match the snapshot manifest.')
  }
  if (
    input.throughCreatedOrder !== undefined &&
    input.throughCreatedOrder !== manifest.snapshot.nodeHighWaterMark
  ) {
    throw new Error('The export high-water mark must match the snapshot manifest.')
  }
  if (
    input.snapshotStateRevision !== undefined &&
    input.snapshotStateRevision !== manifest.snapshot.stateRevision
  ) {
    throw new Error('The export state revision must match the snapshot manifest.')
  }
  if (input.capturedAt !== undefined && input.capturedAt !== manifest.snapshot.capturedAt) {
    throw new Error('The export capture time must match the snapshot manifest.')
  }
}

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
  const throughCreatedOrder = manifest?.snapshot.nodeHighWaterMark ?? input.throughCreatedOrder
  const snapshotStateRevision = manifest?.snapshot.stateRevision ?? input.snapshotStateRevision
  const capturedAt = manifest?.snapshot.capturedAt ?? input.capturedAt
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
  if (input.afterCreatedOrder !== undefined && !input.snapshotManifest) {
    throw new Error('Sessions export continuation requires the first page snapshotManifest.')
  }
  assertManifestTarget(input)
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
