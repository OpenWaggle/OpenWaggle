import type { SessionId } from '@shared/types/brand'
import type {
  AgentAssistantMessageEvent,
  AgentTransportEvent,
  AgentTransportMessageUpdateEvent,
} from '@shared/types/stream'

/**
 * Coalesces streamed deltas on their way from the GUI main process to a renderer (D8, B2).
 *
 * Every token used to cross IPC as its own `agent:event`, for every streaming Session, into
 * every window, and each delivery cost the renderer a task and a React commit. Consecutive text,
 * reasoning and tool-input deltas of one message part now merge into one event per flush:
 * every 33 ms for a Session the window shows, and a slower beat for Sessions it only tracks
 * in the background (their render snapshot still needs the text, so they are merged, not dropped).
 *
 * Order is kept: any other event of the Session is delivered after its pending delta, and any
 * other message the main process sends flushes every pending delta first (`flushAll`).
 */

/**
 * Thirty updates a second for a Session the window shows. Measured at 4× CPU throttle, flushing
 * every 33 ms rather than 16 ms took the renderer from about 45% to 39% busy while streaming, at
 * the same p99 frame, and text arriving 30 times a second still reads as continuous.
 */
export const SHOWN_SESSION_FLUSH_MS = 33
/** Sessions a window does not show only feed its activity and route-switch snapshots. */
export const BACKGROUND_SESSION_FLUSH_MS = 250

export interface AgentEventTarget {
  readonly id: number
  readonly send: (payload: {
    readonly sessionId: SessionId
    readonly event: AgentTransportEvent
  }) => void
}

type DeltaEvent = AgentTransportMessageUpdateEvent & {
  readonly assistantMessageEvent: Extract<
    AgentAssistantMessageEvent,
    { readonly type: 'text_delta' | 'thinking_delta' | 'toolcall_delta' }
  >
}

function isDeltaEvent(event: AgentTransportEvent): event is DeltaEvent {
  if (event.type !== 'message_update' || event.rawEvent !== undefined) return false
  const type = event.assistantMessageEvent.type
  return type === 'text_delta' || type === 'thinking_delta' || type === 'toolcall_delta'
}

/** The merged event, or `null` when `next` does not continue `pending`'s part. */
export function mergeDeltaEvents(pending: DeltaEvent, next: DeltaEvent): DeltaEvent | null {
  const previous = pending.assistantMessageEvent
  const incoming = next.assistantMessageEvent
  if (
    pending.messageId !== next.messageId ||
    pending.model !== next.model ||
    previous.contentIndex !== incoming.contentIndex
  ) {
    return null
  }
  // The merged event is the latest one with every delta since the pending one.
  const common = next
  if (previous.type === 'text_delta' && incoming.type === 'text_delta') {
    return {
      ...common,
      assistantMessageEvent: { ...incoming, delta: previous.delta + incoming.delta },
    }
  }
  if (previous.type === 'thinking_delta' && incoming.type === 'thinking_delta') {
    return {
      ...common,
      assistantMessageEvent: { ...incoming, delta: previous.delta + incoming.delta },
    }
  }
  // A tool input delta either carries the whole input so far or only raw text; the renderer
  // applies one or the other, so only deltas of the same form merge.
  if (
    previous.type === 'toolcall_delta' &&
    incoming.type === 'toolcall_delta' &&
    previous.toolCallId === incoming.toolCallId &&
    (previous.input === undefined) === (incoming.input === undefined)
  ) {
    return {
      ...common,
      assistantMessageEvent: { ...incoming, delta: previous.delta + incoming.delta },
    }
  }
  return null
}

interface PendingDelta {
  event: DeltaEvent
  readonly timer: ReturnType<typeof setTimeout>
}

export class AgentEventDelivery {
  /** Per target, the pending delta of each Session. */
  private readonly pending = new Map<number, Map<SessionId, PendingDelta>>()
  /** Per target, the Sessions it shows; a target that never said shows every Session. */
  private readonly shown = new Map<number, ReadonlySet<SessionId>>()

  setShownSessions(targetId: number, sessionIds: readonly SessionId[]) {
    this.shown.set(targetId, new Set(sessionIds))
  }

  /** Drops a closed target's state; its pending deltas have nowhere to go. */
  forgetTarget(targetId: number) {
    for (const entry of this.pending.get(targetId)?.values() ?? []) {
      clearTimeout(entry.timer)
    }
    this.pending.delete(targetId)
    this.shown.delete(targetId)
  }

  deliver(targets: readonly AgentEventTarget[], sessionId: SessionId, event: AgentTransportEvent) {
    for (const target of targets) this.deliverTo(target, sessionId, event)
  }

  /** Sends every pending delta now, before a message on another channel. */
  flushAll(targets: readonly AgentEventTarget[]) {
    for (const target of targets) {
      const sessions = this.pending.get(target.id)
      if (!sessions) continue
      for (const sessionId of [...sessions.keys()]) this.flush(target, sessionId)
    }
  }

  private deliverTo(target: AgentEventTarget, sessionId: SessionId, event: AgentTransportEvent) {
    const sessions = this.pending.get(target.id)
    const pending = sessions?.get(sessionId)
    if (pending && isDeltaEvent(event)) {
      const merged = mergeDeltaEvents(pending.event, event)
      if (merged) {
        pending.event = merged
        return
      }
    }
    if (pending) this.flush(target, sessionId)
    if (!isDeltaEvent(event)) {
      target.send({ sessionId, event })
      return
    }
    const timer = setTimeout(
      () => this.flush(target, sessionId),
      this.flushDelayMs(target.id, sessionId),
    )
    // Read again: flushing a pending delta may have dropped the target's map.
    let targetSessions = this.pending.get(target.id)
    if (!targetSessions) {
      targetSessions = new Map()
      this.pending.set(target.id, targetSessions)
    }
    targetSessions.set(sessionId, { event, timer })
  }

  private flush(target: AgentEventTarget, sessionId: SessionId) {
    const sessions = this.pending.get(target.id)
    const pending = sessions?.get(sessionId)
    if (!sessions || !pending) return
    sessions.delete(sessionId)
    if (sessions.size === 0) this.pending.delete(target.id)
    clearTimeout(pending.timer)
    target.send({ sessionId, event: pending.event })
  }

  private flushDelayMs(targetId: number, sessionId: SessionId) {
    const shown = this.shown.get(targetId)
    return !shown || shown.has(sessionId) ? SHOWN_SESSION_FLUSH_MS : BACKGROUND_SESSION_FLUSH_MS
  }
}
