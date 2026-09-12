import type { SessionId } from '@shared/types/brand'
import { publishSessionResourceInvalidation } from './session-resource-invalidation'

export const SESSION_OUTPUT_RETRY_BACKOFF_MS = [250, 1_000, 4_000] as const

interface PendingRetryBackoff {
  readonly sessionId: SessionId
  readonly attempt: number
  readonly timer: ReturnType<typeof setTimeout> | null
}

const pendingBackoffs = new Map<string, PendingRetryBackoff>()

/** Starts a fresh recovery cycle after a durable retry is first queued. */
export function beginPendingSessionOutputRetry(sessionId: SessionId): void {
  clearPendingSessionOutputRetry(sessionId)
  pendingBackoffs.set(String(sessionId), { sessionId, attempt: 0, timer: null })
  publishSessionResourceInvalidation(sessionId)
}

/**
 * Schedules one exact-Session wake. A mounted catalog consumes the wake and decides whether
 * another bounded attempt is needed; without a mounted catalog the cycle remains dormant.
 */
export function schedulePendingSessionOutputRetry(sessionId: SessionId): void {
  const key = String(sessionId)
  const current = pendingBackoffs.get(key) ?? { sessionId, attempt: 0, timer: null }
  if (current.timer || current.attempt >= SESSION_OUTPUT_RETRY_BACKOFF_MS.length) return
  const delay = SESSION_OUTPUT_RETRY_BACKOFF_MS[current.attempt]
  const timer = setTimeout(() => {
    pendingBackoffs.set(key, { sessionId, attempt: current.attempt + 1, timer: null })
    publishSessionResourceInvalidation(sessionId)
  }, delay)
  timer.unref()
  pendingBackoffs.set(key, { ...current, timer })
}

export function clearPendingSessionOutputRetry(sessionId: SessionId): void {
  const key = String(sessionId)
  const current = pendingBackoffs.get(key)
  if (current?.timer) clearTimeout(current.timer)
  pendingBackoffs.delete(key)
}
