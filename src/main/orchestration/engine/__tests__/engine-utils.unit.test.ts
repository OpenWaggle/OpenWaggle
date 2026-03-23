import { describe, expect, it } from 'vitest'
import type { MutableTask } from '../engine-state'
import {
  asErrorMessage,
  defaultSleep,
  normalizeRetryPolicy,
  normalizeTimeout,
  retryDelayMs,
  shouldRetry,
  taskToDefinition,
} from '../engine-utils'
import type { OrchestrationTaskRetryPolicy } from '../types'

// ── normalizeRetryPolicy ──

describe('normalizeRetryPolicy', () => {
  it('returns all-zero defaults when undefined', () => {
    const result = normalizeRetryPolicy(undefined)

    expect(result).toEqual({ retries: 0, backoffMs: 0, jitterMs: 0 })
  })

  it('fills missing fields with zero defaults', () => {
    const partial: OrchestrationTaskRetryPolicy = { retries: 3 }
    const result = normalizeRetryPolicy(partial)

    expect(result).toEqual({ retries: 3, backoffMs: 0, jitterMs: 0 })
  })

  it('preserves all values when fully specified', () => {
    const full: OrchestrationTaskRetryPolicy = { retries: 5, backoffMs: 1000, jitterMs: 200 }
    const result = normalizeRetryPolicy(full)

    expect(result).toEqual({ retries: 5, backoffMs: 1000, jitterMs: 200 })
  })

  it('clamps negative values to zero', () => {
    const result = normalizeRetryPolicy({ retries: -2, backoffMs: -100, jitterMs: -50 })

    expect(result).toEqual({ retries: 0, backoffMs: 0, jitterMs: 0 })
  })

  it('floors fractional values', () => {
    const result = normalizeRetryPolicy({ retries: 2.9, backoffMs: 100.7, jitterMs: 50.3 })

    expect(result).toEqual({ retries: 2, backoffMs: 100, jitterMs: 50 })
  })
})

// ── normalizeTimeout ──

describe('normalizeTimeout', () => {
  it('returns undefined when input is undefined', () => {
    const result = normalizeTimeout(undefined)

    expect(result).toBeUndefined()
  })

  it('clamps zero to 1', () => {
    const result = normalizeTimeout(0)

    expect(result).toBe(1)
  })

  it('returns value for a positive number', () => {
    const result = normalizeTimeout(5000)

    expect(result).toBe(5000)
  })

  it('clamps negative values to 1', () => {
    const result = normalizeTimeout(-100)

    expect(result).toBe(1)
  })

  it('floors fractional values', () => {
    const result = normalizeTimeout(3500.9)

    expect(result).toBe(3500)
  })
})

// ── shouldRetry ──

describe('shouldRetry', () => {
  const policy = { retries: 3, backoffMs: 100, jitterMs: 0 }

  it('returns true when attempt is under the retry limit', () => {
    expect(shouldRetry(policy, 1)).toBe(true)
    expect(shouldRetry(policy, 2)).toBe(true)
  })

  it('returns true when attempt equals the retry limit', () => {
    expect(shouldRetry(policy, 3)).toBe(true)
  })

  it('returns false when attempt exceeds the retry limit', () => {
    expect(shouldRetry(policy, 4)).toBe(false)
  })

  it('returns false when retries is 0 and attempt is 1', () => {
    const noRetry = { retries: 0, backoffMs: 0, jitterMs: 0 }

    expect(shouldRetry(noRetry, 1)).toBe(false)
  })
})

// ── retryDelayMs ──

describe('retryDelayMs', () => {
  it('returns 0 when backoff and jitter are both 0', () => {
    const policy = { retries: 3, backoffMs: 0, jitterMs: 0 }

    expect(retryDelayMs(policy, 1, () => 0.5)).toBe(0)
  })

  it('returns backoffMs on first attempt with no jitter', () => {
    const policy = { retries: 3, backoffMs: 100, jitterMs: 0 }

    // attempt 1: 100 * 2^0 = 100
    expect(retryDelayMs(policy, 1, () => 0)).toBe(100)
  })

  it('applies exponential backoff on subsequent attempts', () => {
    const policy = { retries: 5, backoffMs: 100, jitterMs: 0 }

    // attempt 1: 100 * 2^0 = 100
    expect(retryDelayMs(policy, 1, () => 0)).toBe(100)
    // attempt 2: 100 * 2^1 = 200
    expect(retryDelayMs(policy, 2, () => 0)).toBe(200)
    // attempt 3: 100 * 2^2 = 400
    expect(retryDelayMs(policy, 3, () => 0)).toBe(400)
  })

  it('adds jitter bounded by jitterMs', () => {
    const policy = { retries: 3, backoffMs: 100, jitterMs: 50 }

    // attempt 1: backoff = 100, jitter = 0.5 * 50 = 25 → 125
    expect(retryDelayMs(policy, 1, () => 0.5)).toBe(125)
  })

  it('jitter at maximum produces backoff + jitterMs', () => {
    const policy = { retries: 3, backoffMs: 100, jitterMs: 50 }

    // random = 1.0 → jitter = 50 → total = 150
    expect(retryDelayMs(policy, 1, () => 1.0)).toBe(150)
  })

  it('jitter at minimum (0) adds nothing', () => {
    const policy = { retries: 3, backoffMs: 100, jitterMs: 50 }

    expect(retryDelayMs(policy, 1, () => 0)).toBe(100)
  })

  it('returns only jitter when backoff is 0', () => {
    const policy = { retries: 3, backoffMs: 0, jitterMs: 200 }

    // backoff = 0, jitter = 0.75 * 200 = 150
    expect(retryDelayMs(policy, 1, () => 0.75)).toBe(150)
  })

  it('floors the result', () => {
    const policy = { retries: 3, backoffMs: 100, jitterMs: 33 }

    // attempt 1: 100 + 0.5 * 33 = 116.5 → floor → 116
    expect(retryDelayMs(policy, 1, () => 0.5)).toBe(116)
  })
})

// ── taskToDefinition ──

describe('taskToDefinition', () => {
  it('converts a MutableTask to an OrchestrationTaskDefinition', () => {
    const task: MutableTask = {
      id: 'task-1',
      kind: 'analysis',
      dependsOn: ['task-0'],
      input: { key: 'value' },
      status: 'queued',
      retry: { retries: 2, backoffMs: 100, jitterMs: 10 },
      timeoutMs: 5000,
      attempts: [],
      metadata: { label: 'test' },
      createdOrder: 0,
    }

    const definition = taskToDefinition(task)

    expect(definition).toEqual({
      id: 'task-1',
      kind: 'analysis',
      input: { key: 'value' },
      dependsOn: ['task-0'],
      retry: { retries: 2, backoffMs: 100, jitterMs: 10 },
      timeoutMs: 5000,
      metadata: { label: 'test' },
    })
  })

  it('omits optional fields when they are undefined on the task', () => {
    const task: MutableTask = {
      id: 'task-2',
      kind: 'general',
      dependsOn: [],
      status: 'completed',
      retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
      attempts: [],
      createdOrder: 1,
    }

    const definition = taskToDefinition(task)

    expect(definition.id).toBe('task-2')
    expect(definition.kind).toBe('general')
    expect(definition.dependsOn).toEqual([])
    expect(definition.input).toBeUndefined()
    expect(definition.timeoutMs).toBeUndefined()
    expect(definition.metadata).toBeUndefined()
  })

  it('does not include runtime-only MutableTask fields', () => {
    const task: MutableTask = {
      id: 'task-3',
      kind: 'synthesis',
      dependsOn: [],
      status: 'failed',
      retry: { retries: 0, backoffMs: 0, jitterMs: 0 },
      attempts: [
        {
          attempt: 1,
          status: 'error',
          error: 'boom',
          startedAt: '2025-01-01T00:00:00Z',
          finishedAt: '2025-01-01T00:00:01Z',
          durationMs: 1000,
        },
      ],
      startedAt: '2025-01-01T00:00:00Z',
      finishedAt: '2025-01-01T00:00:01Z',
      errorCode: 'TASK_EXECUTION_FAILURE',
      error: 'boom',
      output: { text: 'partial' },
      createdOrder: 2,
    }

    const definition = taskToDefinition(task)

    expect(definition).not.toHaveProperty('status')
    expect(definition).not.toHaveProperty('attempts')
    expect(definition).not.toHaveProperty('startedAt')
    expect(definition).not.toHaveProperty('finishedAt')
    expect(definition).not.toHaveProperty('errorCode')
    expect(definition).not.toHaveProperty('error')
    expect(definition).not.toHaveProperty('output')
    expect(definition).not.toHaveProperty('createdOrder')
  })
})

// ── asErrorMessage ──

describe('asErrorMessage', () => {
  it('returns the message from an Error instance', () => {
    expect(asErrorMessage(new Error('something broke'))).toBe('something broke')
  })

  it('returns the string itself when given a string', () => {
    expect(asErrorMessage('plain string error')).toBe('plain string error')
  })

  it('stringifies a number', () => {
    expect(asErrorMessage(42)).toBe('42')
  })

  it('stringifies null', () => {
    expect(asErrorMessage(null)).toBe('null')
  })

  it('stringifies undefined', () => {
    expect(asErrorMessage(undefined)).toBe('undefined')
  })

  it('stringifies an object', () => {
    expect(asErrorMessage({ code: 'ERR' })).toBe('[object Object]')
  })
})

// ── defaultSleep ──

describe('defaultSleep', () => {
  it('resolves after the specified delay', async () => {
    const start = Date.now()
    await defaultSleep(50)
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(40)
  })

  it('resolves with undefined', async () => {
    const result = await defaultSleep(1)

    expect(result).toBeUndefined()
  })
})
