import { matchBy } from '@diegogbrisa/ts-match'
import { toWaggleInvocation } from '@shared/schemas/waggle'
import { FollowUpId } from '@shared/types/brand'
import type {
  SessionControlMutationResponse,
  SessionControlQueueEditMutationRequest,
} from '@shared/types/session-control'
import {
  FOLLOW_UP_EDIT_HOLD_LEASE_MS,
  type FollowUpQueuePauseReason,
} from '@shared/types/session-control-queue'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import {
  beginFollowUpEdit,
  cancelFollowUpEdit,
  saveFollowUpEdit,
} from '../domain/session-control/follow-up-edit'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import {
  type SessionControlMutationDecision,
  SessionControlRepository,
  type SessionControlRunAdmissionRefusal,
} from '../ports/session-control-repository'

export { FOLLOW_UP_EDIT_CALLER_ID } from '@shared/types/session-control-queue'

export interface EditSessionFollowUpInput {
  readonly callerId: string
  /** The caller is the desktop user without a profile; every other caller is refused. */
  readonly desktopUser: boolean
  readonly hostRunCeiling?: number
  readonly request: SessionControlQueueEditMutationRequest
}

type EditCommand = SessionControlQueueEditMutationRequest['command']

interface EditDecisionContext {
  readonly callerId: string
  readonly holdId: string
  readonly now: number
  readonly nextRunId: Parameters<typeof cancelFollowUpEdit>[0]['nextRunId']
  readonly deferDelivery?: FollowUpQueuePauseReason
}

const PAUSE_REASON_BY_REFUSAL = {
  parent_concurrency_limit_reached: 'parent-limit',
  host_run_ceiling_reached: 'host-run-ceiling',
} as const satisfies Record<SessionControlRunAdmissionRefusal, FollowUpQueuePauseReason>

function decideEdit(
  command: EditCommand,
  state: SessionControlSessionState,
  context: EditDecisionContext,
) {
  return matchBy(command, 'operation')
    .with('queue-edit-begin', (begin) =>
      beginFollowUpEdit({
        state,
        followUpId: FollowUpId(begin.followUpId),
        callerId: context.callerId,
        holdId: context.holdId,
        acquiredAt: context.now,
        leaseMs: FOLLOW_UP_EDIT_HOLD_LEASE_MS,
      }),
    )
    .with('queue-edit-save', (save) =>
      saveFollowUpEdit({
        state,
        followUpId: FollowUpId(save.followUpId),
        callerId: context.callerId,
        holdId: save.holdId,
        expectedQueueRevision: save.expectedQueueRevision,
        content: {
          text: save.input.text,
          attachmentIds: save.input.attachmentIds,
          ...(save.input.waggle ? { waggle: toWaggleInvocation(save.input.waggle) } : {}),
          ...(save.input.visualizationContext
            ? { visualizationContext: save.input.visualizationContext }
            : {}),
        },
        nextRunId: context.nextRunId,
        ...(context.deferDelivery ? { deferDelivery: context.deferDelivery } : {}),
      }),
    )
    .with('queue-edit-cancel', (cancel) =>
      cancelFollowUpEdit({
        state,
        followUpId: FollowUpId(cancel.followUpId),
        holdId: cancel.holdId,
        nextRunId: context.nextRunId,
        ...(context.deferDelivery ? { deferDelivery: context.deferDelivery } : {}),
      }),
    )
    .exhaustive()
}

/**
 * Begins, saves, or cancels a Follow-up edit (ADR 0043). Journaled and idempotent like every queue
 * mutation; a replayed begin returns the hold it acquired. Save and cancel can start the next
 * Follow-up when releasing the hold makes an idle Session's queue runnable.
 */
export function editSessionFollowUp(input: EditSessionFollowUpInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionControlRepository
    const nextRunId = yield* identities.nextRunId
    const holdId = `follow-up-edit-hold-${yield* identities.nextFollowUpId}`
    // Lease expiry is judged against the Host's wall clock when holds are loaded, so the hold is
    // stamped with that clock rather than a caller-visible acceptance time.
    const now = yield* Clock.currentTimeMillis
    const command = input.request.command
    const rejected = (code: string): SessionControlMutationDecision => ({
      accepted: false,
      outcome: {
        operation: command.operation,
        effect: 'rejected',
        sessionId: command.sessionId,
        code,
      },
    })
    const decide = (
      state: SessionControlSessionState,
      deferDelivery?: FollowUpQueuePauseReason,
    ): SessionControlMutationDecision => {
      if (!input.desktopUser) return rejected('follow_up_edit_requires_desktop_user')
      const result = decideEdit(command, state, {
        callerId: input.callerId,
        holdId,
        now,
        nextRunId,
        ...(deferDelivery ? { deferDelivery } : {}),
      })
      return result.accepted
        ? { accepted: true, state: result.state, outcome: result.outcome }
        : rejected(result.code)
    }
    const execution = yield* repository.executeMutation({
      callerId: input.callerId,
      ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
      request: input.request,
      decide: (state) => decide(state),
      // Releasing a hold must not lose the edit because the next Run cannot start yet: save and
      // cancel still apply, and the queue pauses with the reason instead of starting its head.
      decideWithoutNewRun: (state, refusal) => decide(state, PAUSE_REASON_BY_REFUSAL[refusal]),
    })
    return {
      contractVersion: input.request.contractVersion,
      requestId: input.request.requestId,
      idempotencyKey: input.request.idempotencyKey,
      replayed: execution.replayed,
      outcome: execution.outcome,
    } satisfies SessionControlMutationResponse
  })
}
