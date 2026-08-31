import { describe, expect, it } from 'vitest'
import { continuationQuery } from '../sessions-cli-export'

describe('Sessions CLI export continuation', () => {
  it('pins later pages to the branch selected by the first snapshot', () => {
    const query = continuationQuery({
      sessionId: 'session-1',
      afterCreatedOrder: 100,
      manifest: {
        selectedBranchId: 'branch-at-snapshot',
        snapshot: { nodeHighWaterMark: 200, stateRevision: 4, capturedAt: 1234 },
      },
      arguments: { positionals: [], passthrough: [], options: new Map() },
    })

    expect(query).toMatchObject({
      sessionId: 'session-1',
      branchId: 'branch-at-snapshot',
      afterCreatedOrder: 100,
      throughCreatedOrder: 200,
      snapshotStateRevision: 4,
      capturedAt: 1234,
    })
  })

  it('keeps an explicit branch selection authoritative', () => {
    const query = continuationQuery({
      sessionId: 'session-1',
      afterCreatedOrder: 100,
      manifest: { selectedBranchId: 'branch-at-snapshot', snapshot: {} },
      arguments: {
        positionals: [],
        passthrough: [],
        options: new Map([['branch', ['explicit-branch']]]),
      },
    })

    expect(query.branchId).toBe('explicit-branch')
  })
})
