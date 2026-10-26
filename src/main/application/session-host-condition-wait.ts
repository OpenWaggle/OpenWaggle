import type {
  SessionHostEventCursor,
  SessionHostEventDelivery,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import type { SessionHostEventHub, SessionHostEventSubscription } from './session-host-event-hub'

/** First pause before a resynchronization that follows another one with no event between. */
export const SESSION_WAIT_RESYNC_INITIAL_BACKOFF_MS = 50
/** Longest pause between back-to-back resynchronizations; also the worst added wake latency. */
export const SESSION_WAIT_RESYNC_MAX_BACKOFF_MS = 1_000

/**
 * How a bounded condition wait ended. `observed` carries the last canonical read: it matched, or
 * the deadline passed and the caller reports it as a timeout.
 */
export type SessionHostConditionObservation<Value> =
  | { readonly status: 'observed'; readonly value: Value }
  | { readonly status: 'missing' }
  | { readonly status: 'host-stopped' }

export interface SessionHostConditionWaitInput<Value> {
  readonly eventHub: SessionHostEventHub
  /** The cursor the caller's first read is at least as new as. */
  readonly after: SessionHostEventCursor
  /** Which events can change the observed state; others never wake the wait. */
  readonly accepts: (event: SessionHostEventEnvelope) => boolean
  /** Reads the canonical state; `null` when its subject no longer exists. */
  readonly read: () => Promise<Value | null>
  readonly matches: (value: Value) => boolean
  readonly deadline: number
  readonly signal?: AbortSignal
}

export function abortError(signal?: AbortSignal) {
  return signal?.reason instanceof Error ? signal.reason : new Error('aborted')
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal)
}

function nextWithTimeout(
  subscription: SessionHostEventSubscription,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  return new Promise<SessionHostEventDelivery | { readonly status: 'timeout' }>(
    (resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError(signal))
        return
      }
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        callback()
      }
      const onAbort = () => finish(() => reject(abortError(signal)))
      const timer = setTimeout(() => finish(() => resolve({ status: 'timeout' })), timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      subscription.next().then(
        (delivery) => finish(() => resolve(delivery)),
        (error) => finish(() => reject(error)),
      )
    },
  )
}

function pause(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** The first resynchronization reloads at once; only the ones right behind it back off. */
const RESYNCS_BEFORE_BACKOFF = 1
const RESYNC_BACKOFF_GROWTH = 2

/** No pause for the first resynchronization; then 50 ms doubling up to 1 s while they repeat. */
export function sessionWaitResyncBackoffMs(consecutiveResyncs: number) {
  const backedOff = consecutiveResyncs - RESYNCS_BEFORE_BACKOFF
  if (backedOff <= 0) return 0
  return Math.min(
    SESSION_WAIT_RESYNC_INITIAL_BACKOFF_MS * RESYNC_BACKOFF_GROWTH ** (backedOff - 1),
    SESSION_WAIT_RESYNC_MAX_BACKOFF_MS,
  )
}

function subscribeOrUndefined<Value>(
  input: SessionHostConditionWaitInput<Value>,
  after: SessionHostEventCursor,
) {
  const subscribed = input.eventHub.subscribeAfter(after, input.accepts)
  return subscribed.status === 'ready' ? subscribed.subscription : undefined
}

/** Subscribes again at the current cursor, after a backoff when resyncs are back to back. */
async function resubscribe<Value>(
  input: SessionHostConditionWaitInput<Value>,
  consecutiveResyncs: number,
) {
  const backoffMs = Math.min(
    sessionWaitResyncBackoffMs(consecutiveResyncs),
    Math.max(0, input.deadline - Date.now()),
  )
  if (backoffMs > 0) await pause(backoffMs, input.signal)
  return subscribeOrUndefined(input, input.eventHub.cursor())
}

/** Reads the state; answers when it is missing, matches, or the wait is out of time. */
async function observe<Value>(
  input: SessionHostConditionWaitInput<Value>,
  final: boolean,
): Promise<SessionHostConditionObservation<Value> | undefined> {
  const value = await input.read()
  if (value === null) return { status: 'missing' }
  if (final || input.matches(value) || Date.now() >= input.deadline) {
    return { status: 'observed', value }
  }
  return undefined
}

/**
 * Waits until `read` returns a value that `matches`, or the deadline passes, waking on accepted
 * Host events. The events are only wake-ups: every answer comes from `read`.
 *
 * A wait owns its subscription, so it also owns resynchronization. When the hub cannot replay
 * from `after`, or drops the subscription because it fell behind (slow-consumer), the wait
 * subscribes again at the current cursor and then reads the state again, which covers everything
 * the dropped events could have said. It never hands `resync-required` to its caller, who has no
 * cursor to resynchronize. Back-to-back resynchronizations pause with a bounded backoff so a hub
 * that keeps dropping the subscription cannot turn the wait into a busy read loop.
 */
export async function waitForSessionHostCondition<Value>(
  input: SessionHostConditionWaitInput<Value>,
): Promise<SessionHostConditionObservation<Value>> {
  let subscription = subscribeOrUndefined(input, input.after)
  let consecutiveResyncs = subscription ? 0 : 1
  try {
    while (true) {
      if (!subscription) {
        subscription = await resubscribe(input, consecutiveResyncs)
        const observed = await observe(input, false)
        if (observed) return observed
        if (!subscription) {
          consecutiveResyncs += 1
          continue
        }
      }
      const delivery = await nextWithTimeout(
        subscription,
        Math.max(0, input.deadline - Date.now()),
        input.signal,
      )
      if (delivery.status === 'closed') return { status: 'host-stopped' }
      if (delivery.status === 'cursor-advanced') continue
      if (delivery.status === 'resync-required') {
        subscription.close()
        subscription = undefined
        consecutiveResyncs += 1
        continue
      }
      if (delivery.status === 'event') {
        consecutiveResyncs = 0
        subscription.discardPending()
      }
      const observed = await observe(input, delivery.status === 'timeout')
      if (observed) return observed
    }
  } finally {
    subscription?.close()
  }
}
