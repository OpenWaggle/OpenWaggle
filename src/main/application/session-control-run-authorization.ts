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
 * Authorization ceiling, including a Follow-up it resumes. The cap is a Run setting: it never
 * lands on a Follow-up, so a Follow-up the caller queues runs under the Session's authorization,
 * which the caller boundary of whoever queued it still bounds when it starts.
 */
export function withCallerCeiling(
  previous: SessionControlSessionState,
  state: SessionControlSessionState,
  callerCeiling: AgentAuthorizationMode | undefined,
): SessionControlSessionState {
  if (previous.run.state !== 'idle' || state.run.state !== 'starting') return state
  const runAuthorizationOverride = clampRunAuthorizationOverride(
    state.run.intent.runAuthorizationOverride,
    callerCeiling,
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
