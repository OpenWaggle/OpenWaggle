import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { AgentTransportCustomEvent, AgentTransportEvent } from '@shared/types/stream'
import { create } from 'zustand'
import { capAgentInteractionEvents } from '@/features/chat/lib/notification-stack-model'
import type { AgentInteractionEvent } from '@/features/chat/lib/types-chat-row'

const CUSTOM_MESSAGE_LIMIT = 20
const SESSION_STATE_LIMIT = 50

export interface AgentLoopSessionState {
  readonly interactions: readonly AgentLoopInteraction[]
  readonly customMessages: readonly AgentTransportCustomEvent[]
  readonly interactionEvents: readonly AgentInteractionEvent[]
}

interface AgentLoopEventState {
  readonly sessionsById: ReadonlyMap<SessionId, AgentLoopSessionState>
  applyEvent: (sessionId: SessionId, event: AgentTransportEvent) => void
  dismissNotification: (sessionId: SessionId, interactionId: string) => void
  clearSession: (sessionId: SessionId) => void
}

const EMPTY_SESSION_STATE: AgentLoopSessionState = {
  interactions: [],
  customMessages: [],
  interactionEvents: [],
}

function boundedSessions(
  current: ReadonlyMap<SessionId, AgentLoopSessionState>,
  sessionId: SessionId,
  sessionState: AgentLoopSessionState,
) {
  const next = new Map(current)
  // Refresh insertion order so the least recently updated session is evicted first.
  next.delete(sessionId)
  next.set(sessionId, sessionState)
  while (next.size > SESSION_STATE_LIMIT) {
    let oldestSessionId: SessionId | undefined
    for (const [candidateId, candidate] of next) {
      if (candidate.interactions.length > 0) continue
      oldestSessionId = candidateId
      break
    }
    if (oldestSessionId === undefined) break
    next.delete(oldestSessionId)
  }
  return next
}

function applySessionEvent(
  current: AgentLoopSessionState,
  event: AgentTransportEvent,
): AgentLoopSessionState | null {
  if (event.type === 'agent_interaction_request') {
    const interactions =
      event.interaction.kind === 'notify'
        ? current.interactions
        : [
            ...current.interactions.filter(
              (interaction) => interaction.interactionId !== event.interaction.interactionId,
            ),
            event.interaction,
          ]
    return {
      ...current,
      interactions,
      interactionEvents: capAgentInteractionEvents([...current.interactionEvents, event]),
    }
  }

  if (event.type === 'agent_interaction_resolved') {
    return {
      ...current,
      interactions: current.interactions.filter(
        (interaction) => interaction.interactionId !== event.interactionId,
      ),
      interactionEvents: capAgentInteractionEvents([...current.interactionEvents, event]),
    }
  }

  if (event.type === 'custom') {
    return {
      ...current,
      customMessages: [...current.customMessages, event].slice(-CUSTOM_MESSAGE_LIMIT),
    }
  }

  return null
}

/**
 * Workspace-lifetime state for transient Pi interaction events.
 *
 * The workspace monitor is the single writer. Keeping this outside the route-level chat hook means
 * an active-session refresh or controller remount cannot discard a persistent error notification
 * or a pending authorization request. Both event histories and retained sessions are bounded.
 */
export const useAgentLoopEventStore = create<AgentLoopEventState>((set) => ({
  sessionsById: new Map<SessionId, AgentLoopSessionState>(),

  applyEvent(sessionId, event) {
    set((state) => {
      const current = state.sessionsById.get(sessionId) ?? EMPTY_SESSION_STATE
      const nextSession = applySessionEvent(current, event)
      if (!nextSession) return state
      return { sessionsById: boundedSessions(state.sessionsById, sessionId, nextSession) }
    })
  },

  dismissNotification(sessionId, interactionId) {
    set((state) => {
      const current = state.sessionsById.get(sessionId)
      if (!current) return state
      const interactionEvents = current.interactionEvents.filter(
        (event) =>
          !(
            event.type === 'agent_interaction_request' &&
            event.interaction.kind === 'notify' &&
            event.interaction.interactionId === interactionId
          ),
      )
      if (interactionEvents.length === current.interactionEvents.length) return state
      return {
        sessionsById: boundedSessions(state.sessionsById, sessionId, {
          ...current,
          interactionEvents,
        }),
      }
    })
  },

  clearSession(sessionId) {
    set((state) => {
      if (!state.sessionsById.has(sessionId)) return state
      const sessionsById = new Map(state.sessionsById)
      sessionsById.delete(sessionId)
      return { sessionsById }
    })
  },
}))
