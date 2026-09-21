import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-extension'

describe('Pi-native Sessions transcript payload', () => {
  it('builds branch-scoped immutable transcript continuations', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'items',
          sessionId: 'session-worker',
          branchScope: 'active-branch',
          branchId: 'branch-main',
          afterCreatedOrder: 10,
          throughCreatedOrder: 20,
          snapshotHeadNodeId: 'node-head',
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      request: {
        query: {
          operation: 'items',
          branchScope: 'active-branch',
          branchId: 'branch-main',
          afterCreatedOrder: 10,
          throughCreatedOrder: 20,
          snapshotHeadNodeId: 'node-head',
        },
      },
    })
  })
})
