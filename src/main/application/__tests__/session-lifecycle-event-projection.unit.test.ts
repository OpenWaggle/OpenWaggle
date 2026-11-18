import type { SessionHostEventPayload } from '@shared/types/session-host-event'
import type { SessionLifecycleResponse } from '@shared/types/session-lifecycle'
import { afterEach, describe, expect, it } from 'vitest'
import { installSessionHostEventPublisher } from '../../session-host/session-host-events'
import { publishLifecycleResponse } from '../session-lifecycle-event-projection'

let releasePublisher: (() => void) | undefined

afterEach(() => {
  releasePublisher?.()
  releasePublisher = undefined
})

describe('Session lifecycle event projection', () => {
  it('invalidates both a spawned Worker and its parent Hive context', () => {
    const events: SessionHostEventPayload[] = []
    releasePublisher = installSessionHostEventPublisher((event) => events.push(event))
    const response: SessionLifecycleResponse = {
      contractVersion: 2,
      requestId: 'spawn-request',
      idempotencyKey: 'spawn-key',
      replayed: false,
      outcome: {
        operation: 'spawn',
        effect: 'spawned-worker',
        sessionId: 'worker',
        runId: 'worker-run',
        workspaceId: 'workspace',
        parentSessionId: 'queen',
        parentRunId: 'queen-run',
        hiveRootSessionId: 'queen',
        depth: 1,
        delegationId: 'delegation',
        derivedGrantId: 'grant',
      },
    }

    publishLifecycleResponse(response)

    expect(events).toEqual([
      { kind: 'session-list-changed', sessionId: 'queen', change: 'updated' },
      { kind: 'session-list-changed', sessionId: 'worker', change: 'created' },
      {
        kind: 'session-state-changed',
        sessionId: 'worker',
        stateRevision: 1,
        operation: 'spawn',
      },
    ])
  })
})
