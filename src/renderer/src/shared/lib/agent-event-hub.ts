import type { SessionId } from '@shared/types/brand'
import type { IpcEventPayload } from '@shared/types/ipc'
import { api } from './ipc'

type AgentEventPayload = IpcEventPayload<'agent:event'>
export type AgentEventListener = (payload: AgentEventPayload) => void

/**
 * The renderer's one `agent:event` subscription (B13).
 *
 * Each `api.onAgentEvent` subscription is its own contextBridge listener, so every streamed token
 * was cloned across the bridge once per subscriber: five times, by the chat, the background-run
 * monitor, the Session status monitor, the context meter, and git refresh. They subscribe here
 * instead, and the hub holds a single bridge subscription while anyone listens.
 *
 * Listeners run in subscription order, synchronously, as the bridge delivered them. One listener
 * throwing does not keep the event from the others; the error is rethrown on its own task so it
 * is still reported.
 */
const listeners = new Set<AgentEventListener>()
let unsubscribeBridge: (() => void) | null = null

function dispatch(payload: AgentEventPayload) {
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue
    try {
      listener(payload)
    } catch (error) {
      queueMicrotask(() => {
        throw error
      })
    }
  }
}

export function subscribeAgentEvents(listener: AgentEventListener): () => void {
  listeners.add(listener)
  // A stale or partial preload may lack the method; a later subscription tries again.
  if (!unsubscribeBridge && typeof api.onAgentEvent === 'function') {
    unsubscribeBridge = api.onAgentEvent(dispatch)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size > 0 || !unsubscribeBridge) return
    const unsubscribe = unsubscribeBridge
    unsubscribeBridge = null
    unsubscribe()
  }
}

/** How many bridge subscriptions the hub holds; at most one. */
export function agentEventBridgeSubscriptionCount() {
  return unsubscribeBridge ? 1 : 0
}

/**
 * Tells the main process which Sessions this window shows: their streamed deltas arrive about 30
 * times a second, other Sessions' merged on a slower beat (D8). Best effort: a preload without
 * the method, or a failed call, leaves every Session at the faster beat.
 */
export function declareShownSessions(sessionIds: readonly SessionId[]) {
  if (typeof api.setShownSessions !== 'function') return
  void api.setShownSessions(sessionIds).catch(() => undefined)
}
