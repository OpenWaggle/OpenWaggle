import { matchBy } from '@diegogbrisa/ts-match'
import type { RunId } from '@shared/types/brand'
import type { SessionControlSessionState } from './message-aggregate'

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

function interruptExpectedRun(
  input: ApplyRunInterruptionInput,
  run: InterruptibleRun,
): ApplyRunInterruptionResult {
  if (run.runId !== input.expectedRunId) {
    return {
      accepted: false,
      code: 'run_changed',
      currentRunId: run.runId,
      state: input.state,
    }
  }
  const nextRevision = input.state.revision + STATE_REVISION_INCREMENT
  return {
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
}

export function applyRunInterruption(input: ApplyRunInterruptionInput): ApplyRunInterruptionResult {
  return matchBy(input.state.run, 'state')
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
}

export function releaseRejectedRunInterruption(
  state: SessionControlSessionState,
  expectedRunId: RunId,
): SessionControlSessionState {
  if (state.run.state !== 'stopping' || state.run.runId !== expectedRunId) return state
  return {
    ...state,
    revision: state.revision + STATE_REVISION_INCREMENT,
    run: { state: 'idle' },
  }
}
