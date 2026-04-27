import type { ConversationId } from '@shared/types/brand'
import type { AgentPhaseState } from '@shared/types/phase'
import type { AgentTransportEvent } from '@shared/types/stream'

interface ConversationPhaseState {
  current: AgentPhaseState | null
  runStatus: 'idle' | 'running'
}

interface PhaseChangeResult {
  readonly changed: boolean
  readonly phase: AgentPhaseState | null
}

const states = new Map<string, ConversationPhaseState>()

function getState(conversationId: ConversationId): ConversationPhaseState {
  const key = String(conversationId)
  const existing = states.get(key)
  if (existing) return existing

  const created: ConversationPhaseState = {
    current: null,
    runStatus: 'idle',
  }
  states.set(key, created)
  return created
}

function setPhase(
  state: ConversationPhaseState,
  label: AgentPhaseState['label'],
  startedAt: number,
): PhaseChangeResult {
  const next: AgentPhaseState = { label, startedAt }
  if (state.current && state.current.label === next.label) {
    return { changed: false, phase: state.current }
  }
  state.current = next
  return { changed: true, phase: next }
}

function clearPhase(conversationId: ConversationId): PhaseChangeResult {
  const key = String(conversationId)
  const state = states.get(key)
  if (!state) {
    return { changed: false, phase: null }
  }

  const changed = state.current !== null
  states.delete(key)
  return { changed, phase: null }
}

export function updatePhaseFromTransportEvent(
  conversationId: ConversationId,
  event: AgentTransportEvent,
  now: number,
): PhaseChangeResult {
  const state = getState(conversationId)

  if (event.type === 'agent_start') {
    state.runStatus = 'running'
    return setPhase(state, 'Thinking', now)
  }

  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    if (state.runStatus !== 'running') {
      return { changed: false, phase: state.current }
    }
    return setPhase(state, 'Writing', now)
  }

  if (
    event.type === 'message_update' &&
    (event.assistantMessageEvent.type === 'toolcall_start' ||
      event.assistantMessageEvent.type === 'toolcall_end')
  ) {
    return setPhase(state, 'Thinking', now)
  }

  if (event.type === 'agent_end') {
    return clearPhase(conversationId)
  }

  return { changed: false, phase: state.current }
}

export function resetPhaseForConversation(conversationId: ConversationId): PhaseChangeResult {
  return clearPhase(conversationId)
}

export function getPhaseForConversation(conversationId: ConversationId): AgentPhaseState | null {
  const state = states.get(String(conversationId))
  return state?.current ?? null
}
