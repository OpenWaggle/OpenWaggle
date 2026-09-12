import { matchBy } from '@diegogbrisa/ts-match'
import type { RunId } from '@shared/types/brand'

export type SteeringRunSnapshot =
  | { readonly state: 'idle' }
  | {
      readonly state: 'active'
      readonly runId: RunId
      readonly acceptsSteering: boolean
    }
  | { readonly state: 'stopping'; readonly runId: RunId }

export interface SteeringMessageInput {
  readonly requestedRunId: RunId
  readonly run: SteeringRunSnapshot
}

export type SteeringMessagePlan =
  | { readonly accepted: true; readonly action: 'append-steering'; readonly runId: RunId }
  | {
      readonly accepted: false
      readonly code: 'run_not_active' | 'run_changed' | 'run_not_steerable'
      readonly currentRunId?: RunId
    }

export function planSteeringMessage(input: SteeringMessageInput): SteeringMessagePlan {
  return matchBy(input.run, 'state')
    .with('idle', () => ({ accepted: false, code: 'run_not_active' }))
    .with('stopping', (run) => ({
      accepted: false,
      code: run.runId === input.requestedRunId ? 'run_not_steerable' : 'run_changed',
      currentRunId: run.runId,
    }))
    .with('active', (run) => {
      if (run.runId !== input.requestedRunId) {
        return { accepted: false, code: 'run_changed', currentRunId: run.runId }
      }
      if (!run.acceptsSteering) {
        return { accepted: false, code: 'run_not_steerable', currentRunId: run.runId }
      }
      return { accepted: true, action: 'append-steering', runId: run.runId }
    })
    .exhaustive()
}
