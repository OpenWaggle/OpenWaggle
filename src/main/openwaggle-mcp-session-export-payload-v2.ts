import { randomUUID } from 'node:crypto'
import { assertSessionExportBranchSelection } from '@shared/session-export-selection'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import type { SessionToolInputV2 } from './openwaggle-mcp-session-input-types-v2'

function requiredSessionId(input: SessionToolInputV2) {
  if (!input.sessionId) throw new Error('Session ID is required.')
  return input.sessionId
}

function assertManifestTarget(
  input: SessionToolInputV2,
  manifest: NonNullable<SessionToolInputV2['snapshotManifest']>,
  sessionId: string,
) {
  if (manifest.sessionId !== sessionId) {
    throw new Error('The export snapshot manifest belongs to a different Session.')
  }
  if (input.branchScope && input.branchScope !== manifest.branchScope) {
    throw new Error('The export scope must match the snapshot manifest.')
  }
  if (input.branchId && input.branchId !== manifest.selectedBranchId) {
    throw new Error('The export branch must match the snapshot manifest.')
  }
}

function continuationSelection(input: SessionToolInputV2) {
  const manifest = input.snapshotManifest
  const sessionId = requiredSessionId(input)
  if (manifest) assertManifestTarget(input, manifest, sessionId)
  const branchScope = manifest?.branchScope ?? input.branchScope ?? ('active-branch' as const)
  const branchId = manifest?.selectedBranchId ?? input.branchId
  assertSessionExportBranchSelection({ branchScope, ...(branchId ? { branchId } : {}) })
  const includeQueueBodies = manifest?.queue.bodyScope === 'included' || input.includeQueueBodies
  return {
    sessionId,
    branchScope,
    ...(branchId ? { branchId } : {}),
    ...(includeQueueBodies ? { includeQueueBodies: true as const } : {}),
  }
}

export function buildMcpSessionExportPayloadV2(
  input: SessionToolInputV2,
): LocalSessionCommandPayload {
  const manifest = input.snapshotManifest
  if (input.afterCreatedOrder !== undefined && !manifest) {
    throw new Error('MCP export continuation requires the first page snapshotManifest.')
  }
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: {
        operation: 'export',
        ...continuationSelection(input),
        limit: input.limit ?? SESSION_QUERY_TRANSCRIPT_LIMIT,
        ...(input.afterCreatedOrder === undefined
          ? {}
          : { afterCreatedOrder: input.afterCreatedOrder }),
        ...(manifest
          ? {
              throughCreatedOrder: manifest.snapshot.nodeHighWaterMark,
              snapshotStateRevision: manifest.snapshot.stateRevision,
              ...(manifest.snapshot.selectedHeadNodeId
                ? { snapshotHeadNodeId: manifest.snapshot.selectedHeadNodeId }
                : {}),
              capturedAt: manifest.snapshot.capturedAt,
              snapshotManifest: manifest,
            }
          : {}),
      },
    },
  }
}
