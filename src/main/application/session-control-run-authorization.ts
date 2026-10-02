import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'

export function clampRunAuthorizationOverride(
  requested: AgentAuthorizationMode | undefined,
  callerCeiling: AgentAuthorizationMode | undefined,
) {
  return callerCeiling === 'ask-for-approval' ? 'ask-for-approval' : requested
}

/**
 * Caps a Run that this caller's command starts (from `previous`, an idle Session) at the caller's
 * Authorization ceiling, when the Run is the caller's own: its message, or a Follow-up it queued
 * that its command delivers. A Follow-up someone else queued is not clamped when this caller
 * withdraws, reorders, or resumes the queue in front of it: its Run is bounded by the caller
 * boundary of whoever queued it, which delivery checks when it starts. The cap is a Run setting:
 * it never lands on a Follow-up.
 */
export function withCallerCeiling(
  previous: SessionControlSessionState,
  state: SessionControlSessionState,
  caller: {
    readonly callerId: string
    readonly ceiling: AgentAuthorizationMode | undefined
  },
): SessionControlSessionState {
  if (previous.run.state !== 'idle' || state.run.state !== 'starting') return state
  if (state.run.intent.callerId !== caller.callerId) return state
  const runAuthorizationOverride = clampRunAuthorizationOverride(
    state.run.intent.runAuthorizationOverride,
    caller.ceiling,
  )
  if (runAuthorizationOverride === state.run.intent.runAuthorizationOverride) return state
  return {
    ...state,
    run: {
      ...state.run,
      intent: {
        ...state.run.intent,
        ...(runAuthorizationOverride ? { runAuthorizationOverride } : {}),
      },
    },
  }
}
