import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { AgentPhaseState } from '@shared/types/phase'
import type { AgentTransportEvent } from '@shared/types/stream'

interface SessionPhaseState {
  current: AgentPhaseState | null
  runStatus: 'idle' | 'running'
}

interface PhaseChangeResult {
  readonly changed: boolean
  readonly phase: AgentPhaseState | null
}

const states = new Map<string, SessionPhaseState>()

function getState(sessionId: SessionId) {
  const key = String(sessionId)
  const existing = states.get(key)
  if (existing) return existing

  const created: SessionPhaseState = {
    current: null,
    runStatus: 'idle',
  }
  states.set(key, created)
  return created
}

function setPhase(state: SessionPhaseState, label: AgentPhaseState['label'], startedAt: number) {
  const next: AgentPhaseState = { label, startedAt }
  if (state.current && state.current.label === next.label) {
    return { changed: false, phase: state.current }
  }
  state.current = next
  return { changed: true, phase: next }
}

function clearPhase(sessionId: SessionId) {
  const key = String(sessionId)
  const state = states.get(key)
  if (!state) {
    return { changed: false, phase: null }
  }

  const changed = state.current !== null
  states.delete(key)
  return { changed, phase: null }
}

export function updatePhaseFromTransportEvent(
  sessionId: SessionId,
  event: AgentTransportEvent,
  now: number,
): PhaseChangeResult {
  const state = getState(sessionId)

  return matchBy(event, 'type')
    .with('agent_start', () => {
      state.runStatus = 'running'
      return setPhase(state, 'Thinking', now)
    })
    .with('message_update', (value) =>
      matchBy(value.assistantMessageEvent, 'type')
        .with('text_delta', () =>
          state.runStatus === 'running'
            ? setPhase(state, 'Writing', now)
            : { changed: false, phase: state.current },
        )
        .with('toolcall_start', 'toolcall_end', () => setPhase(state, 'Thinking', now))
        .with(
          'text_start',
          'text_end',
          'thinking_start',
          'thinking_delta',
          'thinking_end',
          'toolcall_delta',
          'done',
          'error',
          () => ({ changed: false, phase: state.current }),
        )
        .exhaustive(),
    )
    .with('agent_end', () => clearPhase(sessionId))
    .with(
      'turn_start',
      'turn_end',
      'message_start',
      'message_end',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
      'queue_update',
      'compaction_start',
      'compaction_end',
      'auto_retry_start',
      'auto_retry_end',
      'custom',
      () => ({ changed: false, phase: state.current }),
    )
    .exhaustive()
}

export function resetPhaseForSession(sessionId: SessionId): PhaseChangeResult {
  return clearPhase(sessionId)
}

export function getPhaseForSession(sessionId: SessionId): AgentPhaseState | null {
  const state = states.get(String(sessionId))
  return state?.current ?? null
}
