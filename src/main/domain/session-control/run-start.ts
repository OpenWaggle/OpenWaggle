import type { RunId } from '@shared/types/brand'
import type { SessionControlIntentSnapshot, SessionControlSessionState } from './message-aggregate'

const STATE_REVISION_INCREMENT = 1

export type ApplyRunStartResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: {
        readonly operation: 'start'
        readonly effect: 'started-run'
        readonly sessionId: SessionControlSessionState['sessionId']
        readonly runId: RunId
        readonly stateRevision: number
      }
    }
  | {
      readonly accepted: false
      readonly code: 'run_already_active'
      readonly currentRunId: RunId
      readonly state: SessionControlSessionState
    }

export interface ApplyRunStartInput {
  readonly state: SessionControlSessionState
  readonly runId: RunId
  readonly intent: SessionControlIntentSnapshot
}

export function applyRunStart(input: ApplyRunStartInput): ApplyRunStartResult {
  if (input.state.run.state !== 'idle') {
    return {
      accepted: false,
      code: 'run_already_active',
      currentRunId: input.state.run.runId,
      state: input.state,
    }
  }

  const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
  return {
    accepted: true,
    state: {
      ...input.state,
      revision: nextRevision,
      run: { state: 'starting', runId: input.runId, intent: input.intent },
    },
    outcome: {
      operation: 'start',
      effect: 'started-run',
      sessionId: input.state.sessionId,
      runId: input.runId,
      stateRevision: nextRevision,
    },
  }
}
