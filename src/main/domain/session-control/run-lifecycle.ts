import { matchBy } from '@diegogbrisa/ts-match'
import type { FollowUpId, RunId } from '@shared/types/brand'
import type { SessionControlIntentSnapshot, SessionControlSessionState } from './message-aggregate'

const STATE_REVISION_INCREMENT = 1
const QUEUE_REVISION_INCREMENT = 1

export type RunLifecycleTransitionResult =
  | { readonly accepted: true; readonly state: SessionControlSessionState }
  | {
      readonly accepted: false
      readonly code: 'run_not_starting' | 'run_not_active' | 'run_changed'
      readonly state: SessionControlSessionState
    }

export function activateStartingRun(
  state: SessionControlSessionState,
  expectedRunId: RunId,
): RunLifecycleTransitionResult {
  return matchBy(state.run, 'state')
    .with('idle', () => ({ accepted: false, code: 'run_not_starting', state }))
    .with('starting', (run) =>
      run.runId === expectedRunId
        ? {
            accepted: true,
            state: {
              ...state,
              revision: state.revision + STATE_REVISION_INCREMENT,
              run: { state: 'active', runId: run.runId },
            },
          }
        : { accepted: false, code: 'run_changed', state },
    )
    .with('active', 'stopping', (run) => ({
      accepted: false,
      code: run.runId === expectedRunId ? 'run_not_starting' : 'run_changed',
      state,
    }))
    .exhaustive()
}

export function startExternalSessionRun(
  state: SessionControlSessionState,
  runId: RunId,
  intent: SessionControlIntentSnapshot,
): RunLifecycleTransitionResult {
  if (state.run.state !== 'idle') {
    return { accepted: false, code: 'run_not_active', state }
  }
  return {
    accepted: true,
    state: {
      ...state,
      revision: state.revision + STATE_REVISION_INCREMENT,
      run: { state: 'starting', runId, intent },
    },
  }
}

export function replaceWithExternalSessionRun(
  state: SessionControlSessionState,
  previousRunId: RunId | undefined,
  runId: RunId,
  intent: SessionControlIntentSnapshot,
): RunLifecycleTransitionResult {
  if (state.run.state === 'idle') return startExternalSessionRun(state, runId, intent)
  if (!previousRunId || state.run.runId !== previousRunId) {
    return { accepted: false, code: 'run_changed', state }
  }
  const settled = settleSessionRun(state, previousRunId)
  if (!settled.accepted) return settled
  return startExternalSessionRun(settled.state, runId, intent)
}

export function settleSessionRun(
  state: SessionControlSessionState,
  expectedRunId: RunId,
): RunLifecycleTransitionResult {
  return matchBy(state.run, 'state')
    .with('idle', () => ({ accepted: false, code: 'run_not_active', state }))
    .with('starting', 'active', 'stopping', (run) =>
      run.runId === expectedRunId
        ? {
            accepted: true,
            state: {
              ...state,
              revision: state.revision + STATE_REVISION_INCREMENT,
              run: { state: 'idle' },
            },
          }
        : { accepted: false, code: 'run_changed', state },
    )
    .exhaustive()
}

export type SettleAndScheduleResult =
  | {
      readonly accepted: true
      readonly state: SessionControlSessionState
      readonly scheduled?: {
        readonly followUpId: FollowUpId
        readonly runId: RunId
        readonly intent: SessionControlIntentSnapshot
      }
    }
  | Extract<RunLifecycleTransitionResult, { readonly accepted: false }>

export function settleAndScheduleNextFollowUp(
  state: SessionControlSessionState,
  expectedRunId: RunId,
  nextRunId: RunId,
): SettleAndScheduleResult {
  const settled = settleSessionRun(state, expectedRunId)
  if (!settled.accepted) return settled
  const nextFollowUp = state.followUpQueue.items[0]
  if (
    state.followUpQueue.state === 'paused' ||
    !nextFollowUp ||
    nextFollowUp.deliveryState !== 'pending'
  ) {
    return settled
  }

  return {
    accepted: true,
    state: {
      ...settled.state,
      run: { state: 'starting', runId: nextRunId, intent: nextFollowUp.intent },
      followUpQueue: {
        ...state.followUpQueue,
        revision: state.followUpQueue.revision + QUEUE_REVISION_INCREMENT,
        items: state.followUpQueue.items.slice(1),
      },
    },
    scheduled: { followUpId: nextFollowUp.id, runId: nextRunId, intent: nextFollowUp.intent },
  }
}

export function recoverSessionAfterHostLoss(
  state: SessionControlSessionState,
): SessionControlSessionState {
  if (state.run.state === 'idle') return state
  return {
    ...state,
    revision: state.revision + STATE_REVISION_INCREMENT,
    run: { state: 'idle' },
    followUpQueue: {
      ...state.followUpQueue,
      state: 'paused',
      revision: state.followUpQueue.revision + QUEUE_REVISION_INCREMENT,
    },
  }
}
