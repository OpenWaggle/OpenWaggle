import { afterEach, describe, expect, it, vi } from 'vitest'
import { sessionWaitResyncBackoffMs } from '../session-host-condition-wait'
import type { SessionHostEventHub } from '../session-host-event-hub'
import {
  createSessionWaitTestHarness,
  type SessionWaitTestHarness,
  type SessionWaitTestHarnessOptions,
} from './session-wait-service.test-support'

const RUNNING = { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 }
const IDLE = { stateRevision: 2, activeRunId: null, pendingFollowUpCount: 0 }

function publishTargetEvents(eventHub: SessionHostEventHub, sessionId: string, count: number) {
  for (let index = 0; index < count; index += 1) {
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId,
      stateRevision: 1,
      operation: 'message',
    })
  }
}

function publishSettled(eventHub: SessionHostEventHub, sessionId: string) {
  eventHub.publish({
    kind: 'session-state-changed',
    sessionId,
    stateRevision: 2,
    operation: 'run-settled',
  })
}

async function untilSubscribed(eventHub: SessionHostEventHub) {
  await vi.waitFor(() => expect(eventHub.subscriberCount()).toBe(1))
}

describe('Session wait resynchronization', () => {
  let harness: SessionWaitTestHarness | undefined

  function createHarness(options: SessionWaitTestHarnessOptions) {
    harness = createSessionWaitTestHarness(options)
    return harness
  }

  afterEach(() => {
    harness?.close()
    harness = undefined
  })

  it('keeps waiting through a slow-consumer drop and matches once the target settles', async () => {
    const { eventHub, states, liveness, statusReads, waitForIdle } = createHarness({
      eventHub: { subscriberCapacity: 4 },
    })
    states.set('worker', RUNNING)
    const waiting = waitForIdle('worker', 60_000)
    await untilSubscribed(eventHub)

    publishTargetEvents(eventHub, 'worker', 10)
    // Initial read, the read for the delivered event, then the read that reloads the snapshot.
    await vi.waitFor(() => expect(statusReads()).toBe(3))
    await untilSubscribed(eventHub)
    states.set('worker', IDLE)
    publishSettled(eventHub, 'worker')

    await expect(waiting).resolves.toMatchObject({
      outcome: { operation: 'wait', timedOut: false, matchedSessionIds: ['worker'] },
    })
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('matches from the reloaded snapshot when the settlement was among the dropped events', async () => {
    const hooks: { duringEventRead?: () => void } = {}
    const { eventHub, states, statusReads, waitForIdle } = createHarness({
      eventHub: { subscriberCapacity: 4 },
      onStatusRead: () => {
        if (statusReads() !== 2) return
        hooks.duringEventRead?.()
      },
    })
    hooks.duringEventRead = () => {
      publishTargetEvents(eventHub, 'worker', 10)
      states.set('worker', IDLE)
      publishSettled(eventHub, 'worker')
    }
    states.set('worker', RUNNING)
    const waiting = waitForIdle('worker', 60_000)
    await untilSubscribed(eventHub)

    publishTargetEvents(eventHub, 'worker', 1)

    await expect(waiting).resolves.toMatchObject({
      outcome: { operation: 'wait', timedOut: false, matchedSessionIds: ['worker'] },
    })
    expect(statusReads()).toBe(3)
  })

  it('reports a timeout with the current state, not resync_required, after repeated drops', async () => {
    const { eventHub, states, waitForIdle } = createHarness({
      eventHub: { subscriberCapacity: 2 },
    })
    states.set('worker', RUNNING)
    const flood = setInterval(() => publishTargetEvents(eventHub, 'worker', 5), 5)
    try {
      await expect(waitForIdle('worker', 300)).resolves.toMatchObject({
        outcome: {
          operation: 'wait',
          timedOut: true,
          matchedSessionIds: [],
          states: [{ sessionId: 'worker', activeRunId: 'run-worker' }],
        },
      })
    } finally {
      clearInterval(flood)
    }
    expect(eventHub.subscriberCount()).toBe(0)
  })

  it('resynchronizes when events during the first read overflow the subscription replay', async () => {
    let floodDuringRead: (() => void) | undefined
    const { eventHub, states, waitForIdle } = createHarness({
      eventHub: { subscriberCapacity: 4 },
      onStatusRead: () => {
        const flood = floodDuringRead
        floodDuringRead = undefined
        flood?.()
      },
    })
    floodDuringRead = () => publishTargetEvents(eventHub, 'worker', 10)
    states.set('worker', RUNNING)
    const waiting = waitForIdle('worker', 60_000)
    await untilSubscribed(eventHub)
    states.set('worker', IDLE)
    publishSettled(eventHub, 'worker')

    await expect(waiting).resolves.toMatchObject({
      outcome: { operation: 'wait', timedOut: false, matchedSessionIds: ['worker'] },
    })
  })

  it('resynchronizes when the caller cursor is no longer retained', async () => {
    const { eventHub, states, waitForIdleAfter } = createHarness({
      eventHub: { replayCapacity: 2 },
    })
    publishTargetEvents(eventHub, 'worker', 5)
    states.set('worker', RUNNING)
    const waiting = waitForIdleAfter('worker', 60_000, {
      hostInstanceId: 'host-wait',
      sequence: 0,
    })
    await untilSubscribed(eventHub)
    states.set('worker', IDLE)
    publishSettled(eventHub, 'worker')

    await expect(waiting).resolves.toMatchObject({
      outcome: { operation: 'wait', timedOut: false, matchedSessionIds: ['worker'] },
    })
  })

  it('reads the status once for a burst of target events', async () => {
    const { eventHub, states, statusReads, waitForIdle } = createHarness({})
    states.set('worker', RUNNING)
    const waiting = waitForIdle('worker', 60_000)
    await untilSubscribed(eventHub)

    publishTargetEvents(eventHub, 'worker', 50)
    await vi.waitFor(() => expect(statusReads()).toBe(2))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(statusReads()).toBe(2)
    states.set('worker', IDLE)
    publishSettled(eventHub, 'worker')

    await expect(waiting).resolves.toMatchObject({
      outcome: { timedOut: false, matchedSessionIds: ['worker'] },
    })
    expect(statusReads()).toBe(3)
  })

  it('backs off between resynchronizations that overflow at once', async () => {
    const context: { eventHub?: SessionHostEventHub } = {}
    const created = createHarness({
      eventHub: { subscriberCapacity: 1 },
      onStatusRead: () => {
        if (context.eventHub) publishTargetEvents(context.eventHub, 'worker', 3)
      },
    })
    context.eventHub = created.eventHub
    created.states.set('worker', RUNNING)

    await expect(created.waitForIdle('worker', 400)).resolves.toMatchObject({
      outcome: { operation: 'wait', timedOut: true, matchedSessionIds: [] },
    })
    expect(created.statusReads()).toBeLessThan(20)
    expect(created.eventHub.subscriberCount()).toBe(0)
  })

  it('reloads at once on a first drop and backs off up to a second while drops repeat', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 20].map(sessionWaitResyncBackoffMs)).toEqual([
      0, 0, 50, 100, 200, 400, 800, 1_000, 1_000, 1_000,
    ])
  })

  it('aborts while backing off between resynchronizations', async () => {
    const context: { eventHub?: SessionHostEventHub } = {}
    const created = createHarness({
      eventHub: { subscriberCapacity: 1 },
      onStatusRead: () => {
        if (context.eventHub) publishTargetEvents(context.eventHub, 'worker', 3)
      },
    })
    context.eventHub = created.eventHub
    created.states.set('worker', RUNNING)
    const controller = new AbortController()
    const waiting = created.waitForIdle('worker', 60_000, undefined, controller.signal)
    await vi.waitFor(() => expect(created.statusReads()).toBeGreaterThanOrEqual(4))

    controller.abort(new Error('run replaced'))

    await expect(waiting).rejects.toThrow('run replaced')
    expect(created.eventHub.subscriberCount()).toBe(0)
    expect(created.liveness.ownerCount('wait')).toBe(0)
  })

  it('keeps an export wait through a slow-consumer drop', async () => {
    const { eventHub, exportStatuses, waitForExport } = createHarness({
      eventHub: { subscriberCapacity: 2 },
    })
    exportStatuses.set('export-1', 'running')
    const waiting = waitForExport('worker', 'export-1', 60_000)
    await untilSubscribed(eventHub)
    const progress = (index: number) => ({
      kind: 'session-export-changed' as const,
      sessionId: 'worker',
      exportOperationId: 'export-1',
      status: 'running' as const,
      progress: { recordsWritten: index, resourcesWritten: 0, bytesWritten: index },
    })
    for (let index = 1; index <= 10; index += 1) eventHub.publish(progress(index))
    await vi.waitFor(() => expect(eventHub.subscriberCount()).toBe(1))
    exportStatuses.set('export-1', 'completed')
    eventHub.publish({ ...progress(11), status: 'completed' })

    await expect(waiting).resolves.toMatchObject({
      outcome: {
        operation: 'exports-wait',
        timedOut: false,
        export: { exportOperationId: 'export-1', status: 'completed' },
      },
    })
  })
})
