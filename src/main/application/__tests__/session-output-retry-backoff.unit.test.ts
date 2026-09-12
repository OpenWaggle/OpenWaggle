import { SessionId } from '@shared/types/brand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingSessionOutputRetry,
  SESSION_OUTPUT_RETRY_BACKOFF_MS,
  schedulePendingSessionOutputRetry,
} from '../session-output-retry-backoff'
import { subscribeToSessionResourceInvalidations } from '../session-resource-invalidation'

const SESSION_ONE = SessionId('session-one')

describe('pending Session Output retry backoff', () => {
  afterEach(() => {
    clearPendingSessionOutputRetry(SESSION_ONE)
    vi.useRealTimers()
  })

  it('coalesces timers and caps exact-Session wake attempts', async () => {
    vi.useFakeTimers()
    const invalidations: SessionId[] = []
    const unsubscribe = subscribeToSessionResourceInvalidations(({ sessionId }) => {
      invalidations.push(sessionId)
    })

    try {
      for (const delay of SESSION_OUTPUT_RETRY_BACKOFF_MS) {
        schedulePendingSessionOutputRetry(SESSION_ONE)
        schedulePendingSessionOutputRetry(SESSION_ONE)
        expect(vi.getTimerCount()).toBe(1)
        await vi.advanceTimersByTimeAsync(delay)
      }
      schedulePendingSessionOutputRetry(SESSION_ONE)
      await vi.runAllTimersAsync()

      expect(invalidations).toEqual(SESSION_OUTPUT_RETRY_BACKOFF_MS.map(() => SESSION_ONE))
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      unsubscribe()
    }
  })
})
