import { describe, expect, it } from 'vitest'
import { continuationQuery } from '../sessions-cli-export'

function manifest(selectedBranchId = 'branch-at-snapshot') {
  return {
    schemaVersion: 1 as const,
    sessionId: 'session-1',
    title: 'Session 1',
    branchScope: 'active-branch' as const,
    activeBranchId: selectedBranchId,
    selectedBranchId,
    snapshot: {
      nodeHighWaterMark: 200,
      stateRevision: 4,
      queueRevision: 2,
      capturedAt: 1234,
      selectedHeadNodeId: 'node-at-snapshot',
    },
    activeRunId: null,
    activeTurnIncomplete: false,
    queue: {
      state: 'running' as const,
      pendingCount: 0,
      bodyScope: 'omitted-by-choice' as const,
      omittedBodyCount: 0,
      items: [],
    },
  }
}

describe('Sessions CLI export continuation', () => {
  it('pins later pages to the branch selected by the first snapshot', () => {
    const query = continuationQuery({
      sessionId: 'session-1',
      afterCreatedOrder: 100,
      manifest: manifest(),
      arguments: { positionals: [], passthrough: [], options: new Map() },
    })

    expect(query).toMatchObject({
      sessionId: 'session-1',
      branchId: 'branch-at-snapshot',
      afterCreatedOrder: 100,
      throughCreatedOrder: 200,
      snapshotStateRevision: 4,
      snapshotHeadNodeId: 'node-at-snapshot',
      capturedAt: 1234,
    })
  })

  it('keeps an explicit branch selection authoritative', () => {
    const query = continuationQuery({
      sessionId: 'session-1',
      afterCreatedOrder: 100,
      manifest: manifest(),
      arguments: {
        positionals: [],
        passthrough: [],
        options: new Map([['branch', ['explicit-branch']]]),
      },
    })

    expect(query.branchId).toBe('explicit-branch')
  })
})
