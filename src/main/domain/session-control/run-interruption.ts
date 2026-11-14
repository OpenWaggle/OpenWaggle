import { matchBy } from '@diegogbrisa/ts-match'
import type { RunId } from '@shared/types/brand'
import type { SessionControlSessionState } from './message-aggregate'
import { pauseStrandedFollowUps } from './undelivered-steering'

const STATE_REVISION_INCREMENT = 1

export type ApplyRunInterruptionResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly outcome: {
        readonly operation: 'interrupt'
        readonly effect: 'interruption-requested'
        readonly sessionId: SessionControlSessionState['sessionId']
        readonly runId: RunId
        readonly stateRevision: number
      }
    }
  | {
      readonly accepted: false
      readonly code: 'run_not_active' | 'run_changed' | 'run_already_stopping'
      readonly currentRunId?: RunId
      readonly state: SessionControlSessionState
    }

export interface ApplyRunInterruptionInput {
  readonly state: SessionControlSessionState
  readonly expectedRunId: RunId
}

type InterruptibleRun = Extract<
  SessionControlSessionState['run'],
  { readonly state: 'starting' | 'active' }
>

function interruptExpectedRun(input: ApplyRunInterruptionInput, run: InterruptibleRun) {
  if (run.runId !== input.expectedRunId) {
    const result: ApplyRunInterruptionResult = {
      accepted: false,
      code: 'run_changed',
      currentRunId: run.runId,
      state: input.state,
    }
    return result
  }
  const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
  const result: ApplyRunInterruptionResult = {
    accepted: true,
    state: {
      ...input.state,
      revision: nextRevision,
      run: { state: 'stopping', runId: run.runId },
    },
    outcome: {
      operation: 'interrupt',
      effect: 'interruption-requested',
      sessionId: input.state.sessionId,
      runId: run.runId,
      stateRevision: nextRevision,
    },
  }
  return result
}

export function applyRunInterruption(input: ApplyRunInterruptionInput) {
  const result: ApplyRunInterruptionResult = matchBy(input.state.run, 'state')
    .with('idle', () => ({ accepted: false, code: 'run_not_active', state: input.state }))
    .with('stopping', (run) => ({
      accepted: false,
      code: run.runId === input.expectedRunId ? 'run_already_stopping' : 'run_changed',
      currentRunId: run.runId,
      state: input.state,
    }))
    .with('starting', (run) => interruptExpectedRun(input, run))
    .with('active', (run) => interruptExpectedRun(input, run))
    .exhaustive()
  return result
}

export function releaseRejectedRunInterruption(
  state: SessionControlSessionState,
  expectedRunId: RunId,
) {
  if (state.run.state !== 'stopping' || state.run.runId !== expectedRunId) return state
  // The Run was already gone, so its settlement (and any steers it returned) happened without a
  // successor. Its Follow-ups would otherwise wait in a running queue nothing schedules.
  return pauseStrandedFollowUps({
    ...state,
    revision: state.revision + STATE_REVISION_INCREMENT,
    run: { state: 'idle' },
  })
}
