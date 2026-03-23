import type { ConversationId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import type { OrchestrationRunRecord as CoreRunRecord } from '../engine'
import {
  CANCELLED_ERROR_CODE,
  extractTaskTitle,
  normalizeRunId,
  RUN_ID_PATTERN,
  summarizeCoreRun,
  toSharedRunRecord,
  toSharedTaskRecord,
} from '../run-record-transforms'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCoreTask(
  overrides: Partial<CoreRunRecord['tasks'][string]> = {},
): CoreRunRecord['tasks'][string] {
  return {
    id: 'task-1',
    kind: 'agent',
    dependsOn: [],
    status: 'queued',
    retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
    attempts: [],
    createdOrder: 0,
    ...overrides,
  }
}

function makeCoreRun(overrides: Partial<CoreRunRecord> = {}): CoreRunRecord {
  return {
    runId: 'run-1',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
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

// ---------------------------------------------------------------------------
// CANCELLED_ERROR_CODE
// ---------------------------------------------------------------------------

describe('CANCELLED_ERROR_CODE', () => {
  it('is "TASK_CANCELLED"', () => {
    expect(CANCELLED_ERROR_CODE).toBe('TASK_CANCELLED')
  })
})

// ---------------------------------------------------------------------------
// RUN_ID_PATTERN
// ---------------------------------------------------------------------------

describe('RUN_ID_PATTERN', () => {
  it('matches valid alphanumeric run IDs', () => {
    expect(RUN_ID_PATTERN.test('run-123')).toBe(true)
    expect(RUN_ID_PATTERN.test('abc_def')).toBe(true)
    expect(RUN_ID_PATTERN.test('A')).toBe(true)
    expect(RUN_ID_PATTERN.test('run-id-with-dashes_and_underscores')).toBe(true)
  })

  it('rejects invalid IDs', () => {
    expect(RUN_ID_PATTERN.test('')).toBe(false)
    expect(RUN_ID_PATTERN.test('has spaces')).toBe(false)
    expect(RUN_ID_PATTERN.test('special!chars')).toBe(false)
    expect(RUN_ID_PATTERN.test('dots.not.allowed')).toBe(false)
  })

  it('rejects IDs longer than 128 chars', () => {
    const longId = 'a'.repeat(129)
    expect(RUN_ID_PATTERN.test(longId)).toBe(false)
  })

  it('accepts IDs exactly 128 chars', () => {
    const maxId = 'a'.repeat(128)
    expect(RUN_ID_PATTERN.test(maxId)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// extractTaskTitle
// ---------------------------------------------------------------------------

describe('extractTaskTitle', () => {
  it('extracts title from input object', () => {
    const task = makeCoreTask({ input: { title: 'Build feature X' } })
    expect(extractTaskTitle(task)).toBe('Build feature X')
  })

  it('returns undefined when input is undefined', () => {
    const task = makeCoreTask({ input: undefined })
    expect(extractTaskTitle(task)).toBeUndefined()
  })

  it('returns undefined for non-object input (string)', () => {
    const task = makeCoreTask({ input: 'just a string' })
    expect(extractTaskTitle(task)).toBeUndefined()
  })

  it('returns undefined for array input', () => {
    const task = makeCoreTask({ input: [1, 2, 3] })
    expect(extractTaskTitle(task)).toBeUndefined()
  })

  it('returns undefined when title is missing from input object', () => {
    const task = makeCoreTask({ input: { prompt: 'do something' } })
    expect(extractTaskTitle(task)).toBeUndefined()
  })

  it('returns undefined when title is empty string', () => {
    const task = makeCoreTask({ input: { title: '   ' } })
    expect(extractTaskTitle(task)).toBeUndefined()
  })

  it('returns undefined when title is not a string', () => {
    const task = makeCoreTask({ input: { title: 42 } })
    expect(extractTaskTitle(task)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// toSharedTaskRecord
// ---------------------------------------------------------------------------

describe('toSharedTaskRecord', () => {
  it('converts core task to shared type with branded IDs', () => {
    const task = makeCoreTask({
      id: 'task-abc',
      kind: 'agent',
      status: 'completed',
      dependsOn: ['dep-1', 'dep-2'],
      input: { title: 'My Task' },
      startedAt: '2026-01-01T00:00:00Z',
      finishedAt: '2026-01-01T01:00:00Z',
      errorCode: undefined,
      error: undefined,
      retry: { retries: 2, backoffMs: 500, jitterMs: 100 },
      attempts: [
        {
          attempt: 1,
          status: 'ok',
          startedAt: '2026-01-01T00:00:00Z',
          finishedAt: '2026-01-01T01:00:00Z',
          durationMs: 3600000,
        },
      ],
    })

    const shared = toSharedTaskRecord(task, 3)

    expect(shared.id).toBe('task-abc')
    expect(shared.kind).toBe('agent')
    expect(shared.status).toBe('completed')
    expect(shared.dependsOn).toEqual(['dep-1', 'dep-2'])
    expect(shared.title).toBe('My Task')
    expect(shared.startedAt).toBe('2026-01-01T00:00:00Z')
    expect(shared.finishedAt).toBe('2026-01-01T01:00:00Z')
    expect(shared.retry).toEqual({ retries: 2, backoffMs: 500, jitterMs: 100 })
    expect(shared.attempts).toHaveLength(1)
    expect(shared.createdOrder).toBe(3)
  })

  it('sets title to undefined when input has no title', () => {
    const task = makeCoreTask({ input: { prompt: 'do something' } })
    const shared = toSharedTaskRecord(task, 0)
    expect(shared.title).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// toSharedRunRecord
// ---------------------------------------------------------------------------

describe('toSharedRunRecord', () => {
  it('converts core run + conversationId + fallback to shared type', () => {
    const task1 = makeCoreTask({ id: 't1', status: 'completed', createdOrder: 0 })
    const task2 = makeCoreTask({ id: 't2', status: 'running', createdOrder: 1 })
    const coreRun = makeCoreRun({
      runId: 'run-shared',
      status: 'running',
      startedAt: '2026-01-01T00:00:00Z',
      maxParallelTasks: 2,
      taskOrder: ['t1', 't2'],
      tasks: { t1: task1, t2: task2 },
      outputs: { t1: 'result1' },
    })

    const conversationId = 'conv-abc' as ConversationId
    const shared = toSharedRunRecord(coreRun, conversationId, true, 'model down')

    expect(shared.runId).toBe('run-shared')
    expect(shared.conversationId).toBe('conv-abc')
    expect(shared.status).toBe('running')
    expect(shared.startedAt).toBe('2026-01-01T00:00:00Z')
    expect(shared.maxParallelTasks).toBe(2)
    expect(shared.taskOrder).toHaveLength(2)
    expect(shared.tasks.t1).toBeDefined()
    expect(shared.tasks.t2).toBeDefined()
    expect(shared.outputs).toEqual({ t1: 'result1' })
    expect(shared.fallbackUsed).toBe(true)
    expect(shared.fallbackReason).toBe('model down')
    expect(shared.updatedAt).toBeTypeOf('number')
  })

  it('skips tasks not found in core run', () => {
    const coreRun = makeCoreRun({
      taskOrder: ['missing-task'],
      tasks: {},
    })
    const shared = toSharedRunRecord(coreRun, 'conv-1' as ConversationId, false)
    expect(Object.keys(shared.tasks)).toHaveLength(0)
  })

  it('uses task.createdOrder when available, falls back to index', () => {
    const task = makeCoreTask({ id: 't1', createdOrder: 7 })
    const coreRun = makeCoreRun({
      taskOrder: ['t1'],
      tasks: { t1: task },
    })

    const shared = toSharedRunRecord(coreRun, 'conv-1' as ConversationId, false)
    expect(shared.tasks.t1?.createdOrder).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// summarizeCoreRun
// ---------------------------------------------------------------------------

describe('summarizeCoreRun', () => {
  it('counts tasks by status correctly', () => {
    const tasks: Record<string, CoreRunRecord['tasks'][string]> = {
      t1: makeCoreTask({ status: 'completed' }),
      t2: makeCoreTask({ status: 'completed' }),
      t3: makeCoreTask({ status: 'failed' }),
      t4: makeCoreTask({ status: 'cancelled' }),
      t5: makeCoreTask({ status: 'queued' }),
      t6: makeCoreTask({ status: 'running' }),
      t7: makeCoreTask({ status: 'retrying' }),
    }

    const summary = summarizeCoreRun(tasks)

    expect(summary.total).toBe(7)
    expect(summary.completed).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.cancelled).toBe(1)
    expect(summary.queued).toBe(1)
    expect(summary.running).toBe(1)
    expect(summary.retrying).toBe(1)
  })

  it('returns all zeros for empty tasks', () => {
    const summary = summarizeCoreRun({})

    expect(summary.total).toBe(0)
    expect(summary.completed).toBe(0)
    expect(summary.failed).toBe(0)
    expect(summary.cancelled).toBe(0)
    expect(summary.queued).toBe(0)
    expect(summary.running).toBe(0)
    expect(summary.retrying).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// normalizeRunId
// ---------------------------------------------------------------------------

describe('normalizeRunId', () => {
  it('returns trimmed valid run ID', () => {
    expect(normalizeRunId('  run-123  ')).toBe('run-123')
  })

  it('returns valid ID without trimming needed', () => {
    expect(normalizeRunId('valid_id')).toBe('valid_id')
  })

  it('returns null for empty string', () => {
    expect(normalizeRunId('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(normalizeRunId('   ')).toBeNull()
  })

  it('returns null for invalid characters', () => {
    expect(normalizeRunId('has spaces')).toBeNull()
  })

  it('returns null for special characters', () => {
    expect(normalizeRunId('run!@#')).toBeNull()
  })

  it('returns null for dots in ID', () => {
    expect(normalizeRunId('run.id')).toBeNull()
  })
})
