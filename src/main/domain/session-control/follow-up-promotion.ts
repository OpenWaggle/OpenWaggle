import type { FollowUpId, RunId } from '@shared/types/brand'
import type { SessionControlSessionState } from './message-aggregate'
import { planSteeringMessage, type SteeringRunSnapshot } from './steering'

export interface FollowUpPromotionInput {
  readonly requestedRunId: RunId
  readonly followUpId: FollowUpId
  readonly run: SteeringRunSnapshot
  readonly followUpQueue: {
    readonly items: readonly FollowUpId[]
  }
}

export type FollowUpPromotionPlan =
  | {
      readonly accepted: true
      readonly action: 'promote-follow-up'
      readonly runId: RunId
      readonly followUpId: FollowUpId
      readonly removal: 'after-steering-accepted'
    }
  | {
      readonly accepted: false
      readonly code: 'run_not_active' | 'run_changed' | 'run_not_steerable' | 'follow_up_not_found'
      readonly currentRunId?: RunId
    }

export function planFollowUpPromotion(input: FollowUpPromotionInput): FollowUpPromotionPlan {
  const steering = planSteeringMessage({
    requestedRunId: input.requestedRunId,
    run: input.run,
  })
  if (!steering.accepted) return steering

  if (!input.followUpQueue.items.includes(input.followUpId)) {
    return { accepted: false, code: 'follow_up_not_found' }
  }

  return {
    accepted: true,
    action: 'promote-follow-up',
    runId: steering.runId,
    followUpId: input.followUpId,
    removal: 'after-steering-accepted',
  }
}

export function applyAcceptedFollowUpPromotion(
  state: SessionControlSessionState,
  expectedRunId: RunId,
  followUpId: FollowUpId,
): SessionControlSessionState {
  if (state.run.state !== 'active' || state.run.runId !== expectedRunId) return state
  const itemIndex = state.followUpQueue.items.findIndex((item) => item.id === followUpId)
  if (itemIndex < 0) return state
  return {
    ...state,
    revision: state.revision + 1,
    followUpQueue: {
      ...state.followUpQueue,
      revision: state.followUpQueue.revision + 1,
      items: state.followUpQueue.items.filter((_, index) => index !== itemIndex),
    },
  }
}
