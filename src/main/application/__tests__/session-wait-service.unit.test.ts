import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSessionWaitTestHarness,
  type SessionWaitTestHarness,
} from './session-wait-service.test-support'

describe('Session wait service', () => {
  let harness: SessionWaitTestHarness
  let eventHub: SessionWaitTestHarness['eventHub']
  let liveness: SessionWaitTestHarness['liveness']
  let states: SessionWaitTestHarness['states']
  let exportStatuses: SessionWaitTestHarness['exportStatuses']
  let waitForIdle: SessionWaitTestHarness['waitForIdle']
  let waitForExport: SessionWaitTestHarness['waitForExport']

  beforeEach(() => {
    harness = createSessionWaitTestHarness()
    ;({ eventHub, liveness, states, exportStatuses, waitForIdle, waitForExport } = harness)
  })

  afterEach(() => {
    harness.close()
  })

  it('returns immediately when a requested condition already matches', async () => {
    states.set('worker', { stateRevision: 3, activeRunId: null, pendingFollowUpCount: 0 })

    await expect(waitForIdle('worker', 1_000)).resolves.toMatchObject({
      outcome: { operation: 'wait', timedOut: false, matchedSessionIds: ['worker'] },
    })
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('subscribes once and wakes when the first target reaches the condition', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })
    const waiting = waitForIdle('worker', 1_000)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    expect(liveness.ownerCount('wait')).toBe(1)
    states.set('worker', { stateRevision: 2, activeRunId: null, pendingFollowUpCount: 0 })
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'worker',
      stateRevision: 2,
      operation: 'run-settled',
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: { timedOut: false, matchedSessionIds: ['worker'] },
    })
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('does not let unrelated Session events exhaust a bounded wait subscription', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })
    const waiting = waitForIdle('worker', 1_000)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    for (let stateRevision = 1; stateRevision <= 300; stateRevision += 1) {
      eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'unrelated',
        stateRevision,
        operation: 'message',
      })
    }
    expect(eventHub.subscriberCount()).toBe(1)
    states.set('worker', { stateRevision: 2, activeRunId: null, pendingFollowUpCount: 0 })
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'worker',
      stateRevision: 2,
      operation: 'run-settled',
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: { timedOut: false, matchedSessionIds: ['worker'] },
    })
  })

  it('revalidates Session wait authority before returning an event observation', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })
    let observationCount = 0
    const waiting = waitForIdle('worker', 1_000, async () => {
      observationCount += 1
      if (observationCount > 1) throw new Error('profile_revoked')
      return undefined
    })
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    states.set('worker', { stateRevision: 2, activeRunId: null, pendingFollowUpCount: 0 })
    eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'worker',
      stateRevision: 2,
      operation: 'run-settled',
    })

    await expect(waiting).rejects.toThrow('profile_revoked')
    expect(observationCount).toBe(2)
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('returns compact current state on bounded timeout', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })

    await expect(waitForIdle('worker', 5)).resolves.toMatchObject({
      outcome: {
        timedOut: true,
        matchedSessionIds: [],
        states: [{ sessionId: 'worker', activeRunId: 'run-worker' }],
      },
    })
  })

  it('closes a Session wait subscription immediately when the calling Run is aborted', async () => {
    states.set('worker', { stateRevision: 1, activeRunId: 'run-worker', pendingFollowUpCount: 0 })
    const controller = new AbortController()
    const waiting = waitForIdle('worker', 60_000, undefined, controller.signal)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    controller.abort(new Error('run replaced'))

    await expect(waiting).rejects.toThrow('run replaced')
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('subscribes to one export operation and returns its terminal progress', async () => {
    exportStatuses.set('export-1', 'running')
    const waiting = waitForExport('worker', 'export-1', 1_000)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    exportStatuses.set('export-1', 'completed')
    eventHub.publish({
      kind: 'session-export-changed',
      sessionId: 'worker',
      exportOperationId: 'export-1',
      status: 'completed',
      progress: { recordsWritten: 2, resourcesWritten: 0, bytesWritten: 200 },
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: {
        operation: 'exports-wait',
        timedOut: false,
        export: { exportOperationId: 'export-1', status: 'completed' },
      },
    })
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('does not let unrelated exports exhaust a bounded export wait subscription', async () => {
    exportStatuses.set('export-1', 'running')
    const waiting = waitForExport('worker', 'export-1', 1_000)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    for (let index = 1; index <= 300; index += 1) {
      eventHub.publish({
        kind: 'session-export-changed',
        sessionId: 'unrelated',
        exportOperationId: `export-${index + 1}`,
        status: 'running',
        progress: { recordsWritten: index, resourcesWritten: 0, bytesWritten: index },
      })
    }
    expect(eventHub.subscriberCount()).toBe(1)
    exportStatuses.set('export-1', 'completed')
    eventHub.publish({
      kind: 'session-export-changed',
      sessionId: 'worker',
      exportOperationId: 'export-1',
      status: 'completed',
      progress: { recordsWritten: 2, resourcesWritten: 0, bytesWritten: 200 },
    })

    await expect(waiting).resolves.toMatchObject({
      outcome: {
        operation: 'exports-wait',
        timedOut: false,
        export: { exportOperationId: 'export-1', status: 'completed' },
      },
    })
  })

  it('revalidates export wait authority before returning terminal progress', async () => {
    exportStatuses.set('export-1', 'running')
    let observationCount = 0
    const waiting = waitForExport('worker', 'export-1', 1_000, async () => {
      observationCount += 1
      if (observationCount > 1) throw new Error('target_scope_denied')
      return undefined
    })
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    exportStatuses.set('export-1', 'completed')
    eventHub.publish({
      kind: 'session-export-changed',
      sessionId: 'worker',
      exportOperationId: 'export-1',
      status: 'completed',
      progress: { recordsWritten: 2, resourcesWritten: 0, bytesWritten: 200 },
    })

    await expect(waiting).rejects.toThrow('target_scope_denied')
    expect(observationCount).toBe(2)
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })

  it('closes an export wait subscription immediately when the calling Run is aborted', async () => {
    exportStatuses.set('export-1', 'running')
    const controller = new AbortController()
    const waiting = waitForExport('worker', 'export-1', 60_000, undefined, controller.signal)
    for (let attempt = 0; attempt < 50 && eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }

    controller.abort(new Error('run interrupted'))

    await expect(waiting).rejects.toThrow('run interrupted')
    expect(eventHub.subscriberCount()).toBe(0)
    expect(liveness.ownerCount('wait')).toBe(0)
  })
})
