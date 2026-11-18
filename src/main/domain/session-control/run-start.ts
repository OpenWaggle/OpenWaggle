import type { RunId } from '@shared/types/brand'
import type {
  SessionControlIntentSnapshot,
  SessionControlRunIntent,
  SessionControlSessionState,
} from './message-aggregate'
import { type RunStartSettings, withRunStartSettings } from './run-start-settings'

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
  readonly intent: SessionControlIntentSnapshot & Pick<SessionControlRunIntent, 'hiveWake'>
  readonly runSettings?: RunStartSettings
}

export function applyRunStart(input: ApplyRunStartInput) {
  if (input.state.run.state !== 'idle') {
    const result: ApplyRunStartResult = {
      accepted: false,
      code: 'run_already_active',
      currentRunId: input.state.run.runId,
      state: input.state,
    }
    return result
  }

  const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
  const result: ApplyRunStartResult = {
    accepted: true,
    state: {
      ...input.state,
      revision: nextRevision,
      run: {
        state: 'starting',
        runId: input.runId,
        intent: withRunStartSettings(input.intent, input.runSettings),
      },
    },
    outcome: {
      operation: 'start',
      effect: 'started-run',
      sessionId: input.state.sessionId,
      runId: input.runId,
      stateRevision: nextRevision,
    },
  }
  return result
}
