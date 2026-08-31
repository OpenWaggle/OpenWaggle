import type { SessionExportManifest } from '@shared/types/session-export'
import { describe, expect, it } from 'vitest'
import { buildSessionsToolExportPayload } from '../sessions-tool-export-payload'

const manifest = {
  schemaVersion: 1,
  sessionId: 'worker',
  title: 'Worker',
  branchScope: 'active-branch',
  activeBranchId: 'branch-snapshot',
  selectedBranchId: 'branch-snapshot',
  snapshot: {
    nodeHighWaterMark: 42,
    stateRevision: 7,
    queueRevision: 3,
    capturedAt: 1234,
    selectedHeadNodeId: 'node-snapshot',
  },
  activeRunId: 'run-snapshot',
  activeTurnIncomplete: true,
  queue: {
    state: 'running',
    pendingCount: 0,
    bodyScope: 'included',
    omittedBodyCount: 0,
    items: [],
  },
} satisfies SessionExportManifest

describe('Sessions tool export payload', () => {
  it('derives every immutable continuation field from the first-page manifest', () => {
    const payload = buildSessionsToolExportPayload({
      action: 'export',
      sessionId: 'worker',
      afterCreatedOrder: 10,
      snapshotManifest: manifest,
    })

    expect(payload).toMatchObject({
      contract: 'session-query-v2',
      request: {
        query: {
          operation: 'export',
          sessionId: 'worker',
          branchScope: 'active-branch',
          branchId: 'branch-snapshot',
          includeQueueBodies: true,
          afterCreatedOrder: 10,
          throughCreatedOrder: 42,
          snapshotStateRevision: 7,
          snapshotHeadNodeId: 'node-snapshot',
          capturedAt: 1234,
          snapshotManifest: manifest,
        },
      },
    })
  })
})
