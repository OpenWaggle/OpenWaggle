import type { RunId } from '@shared/types/brand'
import type { SessionControlIntentSnapshot, SessionControlSessionState } from './message-aggregate'

export function startClaimedReplacement(
  state: SessionControlSessionState,
  interruptedRunId: RunId,
  replacementRunId: RunId,
  intent: SessionControlIntentSnapshot,
): SessionControlSessionState {
  if (state.run.state !== 'stopping' || state.run.runId !== interruptedRunId) return state
  return {
    ...state,
    revision: state.revision + 1,
    run: { state: 'starting', runId: replacementRunId, intent },
  }
}
