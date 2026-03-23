import { describe, expect, it } from 'vitest'
import { buildInitialState, restoreState, snapshotState, toRunSummary } from '../engine-state'
import type {
  OrchestrationRunDefinition,
  OrchestrationRunRecord,
  OrchestrationTaskDefinition,
  OrchestrationTaskRecord,
} from '../types'

// ── Helpers ──

function makeTaskDefinition(
  overrides: Partial<OrchestrationTaskDefinition> = {},
): OrchestrationTaskDefinition {
  return {
    id: 'task-1',
    kind: 'general',
    ...overrides,
  }
}

function makeTaskRecord(overrides: Partial<OrchestrationTaskRecord> = {}): OrchestrationTaskRecord {
  return {
    id: 'task-1',
    kind: 'general',
    dependsOn: [],
    status: 'queued',
    retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
    attempts: [],
    createdOrder: 0,
    ...overrides,
  }
}

function makeRunRecord(overrides: Partial<OrchestrationRunRecord> = {}): OrchestrationRunRecord {
  return {
    runId: 'run-1',
    status: 'completed',
    startedAt: '2025-01-01T00:00:00Z',
    tasks: {},
    taskOrder: [],
    outputs: {},
    summary: {
      total: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      queued: 0,
      running: 0,
      retrying: 0,
    },
    ...overrides,
  }
}

const NOW = '2025-06-15T12:00:00Z'
const nowIso = (): string => NOW

// ── buildInitialState ──

describe('buildInitialState', () => {
  it('creates a state with correct runId and status', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'my-run',
      tasks: [makeTaskDefinition({ id: 'a' })],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.runId).toBe('my-run')
    expect(state.status).toBe('running')
    expect(state.startedAt).toBe(NOW)
  })

  it('generates a runId when none is provided', () => {
    const definition: OrchestrationRunDefinition = {
      tasks: [makeTaskDefinition({ id: 'a' })],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.runId).toBeTruthy()
    expect(typeof state.runId).toBe('string')
  })

  it('initializes tasks as a Map with all queued', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'a' }), makeTaskDefinition({ id: 'b', dependsOn: ['a'] })],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.tasks.size).toBe(2)
    expect(state.tasks.get('a')?.status).toBe('queued')
    expect(state.tasks.get('b')?.status).toBe('queued')
  })

  it('preserves task order in taskOrder array', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [
        makeTaskDefinition({ id: 'x' }),
        makeTaskDefinition({ id: 'y' }),
        makeTaskDefinition({ id: 'z' }),
      ],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.taskOrder).toEqual(['x', 'y', 'z'])
  })

  it('resolves dependency graph correctly', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [
        makeTaskDefinition({ id: 'a' }),
        makeTaskDefinition({ id: 'b', dependsOn: ['a'] }),
        makeTaskDefinition({ id: 'c', dependsOn: ['a', 'b'] }),
      ],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.tasks.get('a')?.dependsOn).toEqual([])
    expect(state.tasks.get('b')?.dependsOn).toEqual(['a'])
    expect(state.tasks.get('c')?.dependsOn).toEqual(['a', 'b'])
  })

  it('normalizes retry policy on each task', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [
        makeTaskDefinition({ id: 'a', retry: { retries: 3 } }),
        makeTaskDefinition({ id: 'b' }),
      ],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.tasks.get('a')?.retry).toEqual({ retries: 3, backoffMs: 0, jitterMs: 0 })
    expect(state.tasks.get('b')?.retry).toEqual({ retries: 0, backoffMs: 0, jitterMs: 0 })
  })

  it('normalizes timeout on each task', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'a', timeoutMs: 5000 }), makeTaskDefinition({ id: 'b' })],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.tasks.get('a')?.timeoutMs).toBe(5000)
    expect(state.tasks.get('b')?.timeoutMs).toBeUndefined()
  })

  it('defaults maxParallelTasks to 4', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'a' })],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.maxParallelTasks).toBe(4)
  })

  it('respects explicit maxParallelTasks', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'a' })],
      maxParallelTasks: 8,
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.maxParallelTasks).toBe(8)
  })

  it('clamps maxParallelTasks to at least 1', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'a' })],
      maxParallelTasks: 0,
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.maxParallelTasks).toBe(1)
  })

  it('initializes outputs as empty object', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'a' })],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.outputs).toEqual({})
  })

  it('sets createdOrder based on array index', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'first' }), makeTaskDefinition({ id: 'second' })],
    }

    const state = buildInitialState(definition, nowIso)

    expect(state.tasks.get('first')?.createdOrder).toBe(0)
    expect(state.tasks.get('second')?.createdOrder).toBe(1)
  })

  it('throws on duplicate task IDs', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'dup' }), makeTaskDefinition({ id: 'dup' })],
    }

    expect(() => buildInitialState(definition, nowIso)).toThrow(/duplicate task id 'dup'/)
  })

  it('throws when a task depends on an unknown task', () => {
    const definition: OrchestrationRunDefinition = {
      runId: 'run-1',
      tasks: [makeTaskDefinition({ id: 'a', dependsOn: ['nonexistent'] })],
    }

    expect(() => buildInitialState(definition, nowIso)).toThrow(
      /task 'a' depends on unknown task 'nonexistent'/,
    )
  })
})

// ── restoreState ──

describe('restoreState', () => {
  it('restores a basic snapshot into MutableRunState', () => {
    const snapshot = makeRunRecord({
      runId: 'restored-run',
      status: 'completed',
      startedAt: '2025-01-01T00:00:00Z',
      taskOrder: ['t1'],
      tasks: {
        t1: makeTaskRecord({ id: 't1', status: 'completed' }),
      },
      outputs: { t1: 'result' },
    })

    const state = restoreState(snapshot)

    expect(state.runId).toBe('restored-run')
    expect(state.status).toBe('running')
    expect(state.startedAt).toBe('2025-01-01T00:00:00Z')
    expect(state.tasks.size).toBe(1)
    expect(state.tasks.get('t1')?.status).toBe('completed')
    expect(state.outputs).toEqual({ t1: 'result' })
  })

  it('resets running tasks to queued status', () => {
    const snapshot = makeRunRecord({
      taskOrder: ['t1'],
      tasks: {
        t1: makeTaskRecord({ id: 't1', status: 'running' }),
      },
    })

    const state = restoreState(snapshot)

    expect(state.tasks.get('t1')?.status).toBe('queued')
  })

  it('resets retrying tasks to queued status', () => {
    const snapshot = makeRunRecord({
      taskOrder: ['t1'],
      tasks: {
        t1: makeTaskRecord({ id: 't1', status: 'retrying' }),
      },
    })

    const state = restoreState(snapshot)

    expect(state.tasks.get('t1')?.status).toBe('queued')
  })

  it('preserves completed and failed statuses', () => {
    const snapshot = makeRunRecord({
      taskOrder: ['a', 'b', 'c'],
      tasks: {
        a: makeTaskRecord({ id: 'a', status: 'completed', createdOrder: 0 }),
        b: makeTaskRecord({ id: 'b', status: 'failed', createdOrder: 1 }),
        c: makeTaskRecord({ id: 'c', status: 'cancelled', createdOrder: 2 }),
      },
    })

    const state = restoreState(snapshot)

    expect(state.tasks.get('a')?.status).toBe('completed')
    expect(state.tasks.get('b')?.status).toBe('failed')
    expect(state.tasks.get('c')?.status).toBe('cancelled')
  })

  it('always sets status to running regardless of snapshot status', () => {
    const snapshot = makeRunRecord({ status: 'failed' })

    const state = restoreState(snapshot)

    expect(state.status).toBe('running')
  })

  it('defaults maxParallelTasks to 4 when snapshot omits it', () => {
    const snapshot = makeRunRecord({ maxParallelTasks: undefined })

    const state = restoreState(snapshot)

    expect(state.maxParallelTasks).toBe(4)
  })

  it('produces independent copies of arrays and objects', () => {
    const snapshot = makeRunRecord({
      taskOrder: ['t1'],
      tasks: {
        t1: makeTaskRecord({
          id: 't1',
          dependsOn: ['dep-a'],
          attempts: [
            {
              attempt: 1,
              status: 'ok',
              startedAt: '2025-01-01T00:00:00Z',
              finishedAt: '2025-01-01T00:00:01Z',
              durationMs: 1000,
            },
          ],
        }),
      },
      outputs: { t1: 'data' },
    })

    const state = restoreState(snapshot)

    // Mutations on restored state should not affect the snapshot
    state.taskOrder.push('extra')
    expect(snapshot.taskOrder).not.toContain('extra')

    state.outputs.new = 'val'
    expect(snapshot.outputs).not.toHaveProperty('new')
  })

  it('skips task IDs in taskOrder that have no matching task record', () => {
    const snapshot = makeRunRecord({
      taskOrder: ['exists', 'ghost'],
      tasks: {
        exists: makeTaskRecord({ id: 'exists' }),
      },
    })

    const state = restoreState(snapshot)

    expect(state.tasks.size).toBe(1)
    expect(state.tasks.has('ghost')).toBe(false)
    // taskOrder still includes 'ghost' since it copies the array directly
    expect(state.taskOrder).toContain('ghost')
  })
})

// ── snapshotState ──

describe('snapshotState', () => {
  it('serializes MutableRunState to an OrchestrationRunRecord', () => {
    const state = buildInitialState(
      {
        runId: 'snap-run',
        tasks: [makeTaskDefinition({ id: 'a' }), makeTaskDefinition({ id: 'b', dependsOn: ['a'] })],
      },
      nowIso,
    )

    const record = snapshotState(state)

    expect(record.runId).toBe('snap-run')
    expect(record.status).toBe('running')
    expect(record.startedAt).toBe(NOW)
    expect(record.taskOrder).toEqual(['a', 'b'])
    expect(record.tasks.a).toBeDefined()
    expect(record.tasks.b).toBeDefined()
  })

  it('computes summary counts by status', () => {
    const state = buildInitialState(
      {
        runId: 'summary-run',
        tasks: [
          makeTaskDefinition({ id: 'a' }),
          makeTaskDefinition({ id: 'b' }),
          makeTaskDefinition({ id: 'c' }),
        ],
      },
      nowIso,
    )

    // Mutate tasks to different statuses
    const taskA = state.tasks.get('a')
    const taskB = state.tasks.get('b')
    expect(taskA).toBeDefined()
    expect(taskB).toBeDefined()
    if (taskA) taskA.status = 'completed'
    if (taskB) taskB.status = 'failed'
    // 'c' stays 'queued'

    const record = snapshotState(state)

    expect(record.summary).toEqual({
      total: 3,
      completed: 1,
      failed: 1,
      cancelled: 0,
      queued: 1,
      running: 0,
      retrying: 0,
    })
  })

  it('produces an independent copy of taskOrder and outputs', () => {
    const state = buildInitialState(
      {
        runId: 'copy-run',
        tasks: [makeTaskDefinition({ id: 'a' })],
      },
      nowIso,
    )
    state.outputs.a = 'result'

    const record = snapshotState(state)

    // Mutate original state
    state.taskOrder.push('extra')
    state.outputs.b = 'new'

    expect(record.taskOrder).not.toContain('extra')
    expect(record.outputs).not.toHaveProperty('b')
  })

  it('includes finishedAt when set on the state', () => {
    const state = buildInitialState(
      { runId: 'fin-run', tasks: [makeTaskDefinition({ id: 'a' })] },
      nowIso,
    )
    state.finishedAt = '2025-06-15T13:00:00Z'

    const record = snapshotState(state)

    expect(record.finishedAt).toBe('2025-06-15T13:00:00Z')
  })

  it('copies task-level fields accurately', () => {
    const state = buildInitialState(
      {
        runId: 'detail-run',
        tasks: [
          makeTaskDefinition({
            id: 't1',
            kind: 'analysis',
            input: { prompt: 'test' },
            retry: { retries: 2, backoffMs: 100, jitterMs: 10 },
            timeoutMs: 3000,
            metadata: { label: 'important' },
          }),
        ],
      },
      nowIso,
    )

    const task = state.tasks.get('t1')
    expect(task).toBeDefined()
    if (!task) return
    task.status = 'completed'
    task.startedAt = '2025-06-15T12:01:00Z'
    task.finishedAt = '2025-06-15T12:02:00Z'
    task.output = { text: 'done' }
    task.attempts = [
      {
        attempt: 1,
        status: 'ok',
        startedAt: '2025-06-15T12:01:00Z',
        finishedAt: '2025-06-15T12:02:00Z',
        durationMs: 60000,
      },
    ]

    const record = snapshotState(state)
    const recordTask = record.tasks.t1

    expect(recordTask.id).toBe('t1')
    expect(recordTask.kind).toBe('analysis')
    expect(recordTask.input).toEqual({ prompt: 'test' })
    expect(recordTask.status).toBe('completed')
    expect(recordTask.retry).toEqual({ retries: 2, backoffMs: 100, jitterMs: 10 })
    expect(recordTask.timeoutMs).toBe(3000)
    expect(recordTask.metadata).toEqual({ label: 'important' })
    expect(recordTask.output).toEqual({ text: 'done' })
    expect(recordTask.attempts).toHaveLength(1)
    expect(recordTask.startedAt).toBe('2025-06-15T12:01:00Z')
    expect(recordTask.finishedAt).toBe('2025-06-15T12:02:00Z')
  })
})

// ── toRunSummary ──

describe('toRunSummary', () => {
  it('returns a summary with runId, status, and outputs', () => {
    const record = makeRunRecord({
      runId: 'sum-run',
      status: 'completed',
      outputs: { a: 'done' },
      taskOrder: [],
    })

    const summary = toRunSummary(record)

    expect(summary.runId).toBe('sum-run')
    expect(summary.status).toBe('completed')
    expect(summary.outputs).toEqual({ a: 'done' })
  })

  it('collects failed task IDs', () => {
    const record = makeRunRecord({
      runId: 'fail-run',
      status: 'failed',
      taskOrder: ['a', 'b', 'c'],
      tasks: {
        a: makeTaskRecord({ id: 'a', status: 'completed' }),
        b: makeTaskRecord({ id: 'b', status: 'failed' }),
        c: makeTaskRecord({ id: 'c', status: 'failed' }),
      },
    })

    const summary = toRunSummary(record)

    expect(summary.failedTaskIds).toEqual(['b', 'c'])
  })

  it('collects cancelled task IDs', () => {
    const record = makeRunRecord({
      runId: 'cancel-run',
      status: 'cancelled',
      taskOrder: ['a', 'b'],
      tasks: {
        a: makeTaskRecord({ id: 'a', status: 'cancelled' }),
        b: makeTaskRecord({ id: 'b', status: 'completed' }),
      },
    })

    const summary = toRunSummary(record)

    expect(summary.cancelledTaskIds).toEqual(['a'])
  })

  it('returns empty arrays when no tasks failed or were cancelled', () => {
    const record = makeRunRecord({
      runId: 'clean-run',
      status: 'completed',
      taskOrder: ['a', 'b'],
      tasks: {
        a: makeTaskRecord({ id: 'a', status: 'completed' }),
        b: makeTaskRecord({ id: 'b', status: 'completed' }),
      },
    })

    const summary = toRunSummary(record)

    expect(summary.failedTaskIds).toEqual([])
    expect(summary.cancelledTaskIds).toEqual([])
  })

  it('preserves task order when collecting failed/cancelled IDs', () => {
    const record = makeRunRecord({
      runId: 'order-run',
      status: 'failed',
      taskOrder: ['z', 'a', 'm'],
      tasks: {
        z: makeTaskRecord({ id: 'z', status: 'failed' }),
        a: makeTaskRecord({ id: 'a', status: 'failed' }),
        m: makeTaskRecord({ id: 'm', status: 'cancelled' }),
      },
    })

    const summary = toRunSummary(record)

    expect(summary.failedTaskIds).toEqual(['z', 'a'])
    expect(summary.cancelledTaskIds).toEqual(['m'])
  })
})
