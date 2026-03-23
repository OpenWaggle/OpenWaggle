import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { AgentCancelledError } from '../../errors'
import {
  isAbortError,
  isAgentCancelledCause,
  isRetryableStallReason,
  toEffectError,
  withAbortBridge,
  withStageTimingEffect,
} from '../agent-effect-utils'

// ---------------------------------------------------------------------------
// isRetryableStallReason
// ---------------------------------------------------------------------------

describe('isRetryableStallReason', () => {
  it('returns true for stream-stall', () => {
    expect(isRetryableStallReason('stream-stall')).toBe(true)
  })

  it('returns true for incomplete-tool-args', () => {
    expect(isRetryableStallReason('incomplete-tool-args')).toBe(true)
  })

  it('returns false for awaiting-tool-result', () => {
    expect(isRetryableStallReason('awaiting-tool-result')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isRetryableStallReason(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isAbortError
// ---------------------------------------------------------------------------

describe('isAbortError', () => {
  it('returns true for Error with name AbortError', () => {
    const error = new Error('operation aborted')
    error.name = 'AbortError'
    expect(isAbortError(error)).toBe(true)
  })

  it('returns true for Error with message "aborted"', () => {
    const error = new Error('aborted')
    expect(isAbortError(error)).toBe(true)
  })

  it('returns true for Error with message " Aborted " (trimmed + case-insensitive)', () => {
    const error = new Error('  Aborted  ')
    expect(isAbortError(error)).toBe(true)
  })

  it('returns false for generic Error', () => {
    expect(isAbortError(new Error('something went wrong'))).toBe(false)
  })

  it('returns false for non-Error value', () => {
    expect(isAbortError('not an error')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isAbortError(null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isAgentCancelledCause
// ---------------------------------------------------------------------------

describe('isAgentCancelledCause', () => {
  it('returns true for AgentCancelledError instance', () => {
    const error = new AgentCancelledError({})
    expect(isAgentCancelledCause(error)).toBe(true)
  })

  it('returns true for AbortError', () => {
    const error = new Error('abort')
    error.name = 'AbortError'
    expect(isAgentCancelledCause(error)).toBe(true)
  })

  it('returns false for generic Error', () => {
    expect(isAgentCancelledCause(new Error('not cancelled'))).toBe(false)
  })

  it('returns false for non-Error value', () => {
    expect(isAgentCancelledCause(42)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// toEffectError
// ---------------------------------------------------------------------------

describe('toEffectError', () => {
  it('returns the same Error instance if already an Error', () => {
    const original = new Error('test error')
    const result = toEffectError(original)
    expect(result).toBe(original)
  })

  it('wraps a string into an Error', () => {
    const result = toEffectError('string error')
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('string error')
  })

  it('wraps a number into an Error using String()', () => {
    const result = toEffectError(123)
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('123')
  })

  it('wraps null into an Error', () => {
    const result = toEffectError(null)
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('null')
  })
})

// ---------------------------------------------------------------------------
// withStageTimingEffect
// ---------------------------------------------------------------------------

describe('withStageTimingEffect', () => {
  it('records duration in the provided record on successful completion', async () => {
    const durations: Record<string, number> = {}
    const effect = withStageTimingEffect(durations, 'test-stage', Effect.succeed('result'))

    const result = await Effect.runPromise(effect)
    expect(result).toBe('result')
    expect(durations['test-stage']).toBeTypeOf('number')
    expect(durations['test-stage']).toBeGreaterThanOrEqual(0)
  })

  it('records duration even when the effect fails', async () => {
    const durations: Record<string, number> = {}
    const effect = withStageTimingEffect(durations, 'failing-stage', Effect.fail(new Error('boom')))

    await expect(Effect.runPromise(effect)).rejects.toThrow('boom')
    expect(durations['failing-stage']).toBeTypeOf('number')
    expect(durations['failing-stage']).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------------------
// withAbortBridge
// ---------------------------------------------------------------------------

describe('withAbortBridge', () => {
  it('propagates abort from parent signal to child controller', async () => {
    const parentController = new AbortController()
    let childAborted = false

    const effect = withAbortBridge(parentController.signal, (childController) =>
      Effect.async<string, never>((resume) => {
        childController.signal.addEventListener('abort', () => {
          childAborted = true
          resume(Effect.succeed('aborted'))
        })
        // Trigger parent abort
        parentController.abort()
      }),
    )

    const result = await Effect.runPromise(effect)
    expect(result).toBe('aborted')
    expect(childAborted).toBe(true)
  })

  it('completes normally and cleans up abort listener', async () => {
    const parentController = new AbortController()

    const effect = withAbortBridge(parentController.signal, () => Effect.succeed('done'))

    const result = await Effect.runPromise(effect)
    expect(result).toBe('done')
    // After cleanup, aborting the parent should not cause issues
    parentController.abort()
  })
})
