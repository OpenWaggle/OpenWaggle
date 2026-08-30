import path from 'node:path'
import type { SessionExportManifest, SessionExportNodeRecord } from '@shared/types/session-export'
import type { SessionExportOperationRecord } from '../../ports/session-export-operation-repository'

export const exportManifest: SessionExportManifest = {
  schemaVersion: 1,
  sessionId: 'session-1',
  title: 'Durable export',
  branchScope: 'tree',
  activeBranchId: 'branch-1',
  selectedBranchId: null,
  snapshot: { nodeHighWaterMark: 1, stateRevision: 2, queueRevision: 3, capturedAt: 4 },
  activeRunId: null,
  activeTurnIncomplete: false,
  queue: {
    state: 'running',
    pendingCount: 0,
    bodyScope: 'omitted-by-choice',
    omittedBodyCount: 0,
    items: [],
  },
}

export const exportRecords: readonly SessionExportNodeRecord[] = [
  {
    record: 'node',
    schemaVersion: 1,
    sessionId: 'session-1',
    nodeId: 'node-1',
    parentNodeId: null,
    branchHintId: 'branch-1',
    role: 'assistant',
    kind: 'message',
    timestampMs: 5,
    createdOrder: 1,
    content: { text: 'Ready.' },
    metadata: {},
  },
]

export function exportOperation(
  temporaryRoot: string,
  format: SessionExportOperationRecord['format'],
  filename: string,
): SessionExportOperationRecord {
  const destinationPath = path.join(temporaryRoot, filename)
  return {
    exportOperationId: `export-${format}`,
    callerId: 'caller-1',
    sessionId: 'session-1',
    idempotencyKey: `key-${format}`,
    format,
    destinationPath,
    temporaryPath: `${destinationPath}.temporary`,
    overwriteExisting: false,
    status: 'running',
    cleanupPending: false,
    branchScope: 'tree',
    includeQueueBodies: false,
    resources: [],
    progress: { recordsWritten: 0, resourcesWritten: 0, bytesWritten: 0 },
    cancelRequested: false,
    createdAt: 1,
    updatedAt: 1,
  }
}
