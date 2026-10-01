import { matchBy } from '@diegogbrisa/ts-match'
import { toWaggleInvocation } from '@shared/schemas/waggle'
import { FollowUpId } from '@shared/types/brand'
import type {
  SessionControlMutationOutcome,
  SessionControlMutationResponse,
  SessionControlQueueEditMutationRequest,
} from '@shared/types/session-control'

import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import {
  beginFollowUpEdit,
  cancelFollowUpEdit,
  saveFollowUpEdit,
} from '../domain/session-control/follow-up-edit'
import { FOLLOW_UP_EDIT_HOLD_LEASE_MS } from '../domain/session-control/follow-up-edit-lease'
import type { SessionControlSessionState } from '../domain/session-control/message-aggregate'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import {
  type SessionControlMutationDecision,
  SessionControlRepository,
} from '../ports/session-control-repository'

export { FOLLOW_UP_EDIT_CALLER_ID } from '@shared/types/session-control-queue'

export interface EditSessionFollowUpInput {
  readonly callerId: string
  /** The caller is the desktop user without a profile; every other caller is refused. */
  readonly desktopUser: boolean
  readonly hostRunCeiling?: number
  readonly request: SessionControlQueueEditMutationRequest
  /** See `MutateSessionQueueInput.queueDeliveryAdmitted`. */
  readonly queueDeliveryAdmitted?: boolean
}

type EditCommand = SessionControlQueueEditMutationRequest['command']

interface EditDecisionContext {
  readonly callerId: string
  readonly holdId: string
  readonly acquiredAt: number
}

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
        acquiredAt: context.acquiredAt,
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
      }),
    )
    .with('queue-edit-cancel', (cancel) =>
      cancelFollowUpEdit({
        state,
        followUpId: FollowUpId(cancel.followUpId),
        holdId: cancel.holdId,
      }),
    )
    .exhaustive()
}

/**
 * A replayed begin returns the hold it acquired only while that hold is alive; after a Host
 * restart or expiry it is refused, so a retry cannot pick up a dead hold.
 */
function replayedBegin(
  outcome: SessionControlMutationOutcome,
  state: SessionControlSessionState,
): SessionControlMutationOutcome {
  if (outcome.effect !== 'follow-up-edit-held') return outcome
  const item = state.followUpQueue.items.find((candidate) => candidate.id === outcome.followUpId)
  return item?.editHold?.holdId === outcome.holdId
    ? outcome
    : {
        operation: 'queue-edit-begin',
        effect: 'rejected',
        sessionId: outcome.sessionId,
        code: 'follow_up_edit_not_held',
      }
}

/**
 * Begins, saves, or cancels a Follow-up edit (ADR 0043). Journaled and idempotent like every queue
 * mutation. Save and cancel can start the next Follow-up when releasing the hold makes an idle
 * Session's queue runnable. Cancelling a hold that is already gone is an accepted no-op that still
 * lets the queue deliver, which is how an expired hold resumes its queue.
 */
export function editSessionFollowUp(input: EditSessionFollowUpInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionControlRepository
    const nextRunId = yield* identities.nextRunId
    const holdId = `follow-up-edit-hold-${yield* identities.nextFollowUpId}`
    const acquiredAt = yield* Clock.currentTimeMillis
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
    const execution = yield* repository.executeMutation({
      callerId: input.callerId,
      ...(input.hostRunCeiling ? { hostRunCeiling: input.hostRunCeiling } : {}),
      request: input.request,
      // Releasing a hold lets the queue deliver: the repository starts the next Follow-up when an
      // idle Session's queue can, and pauses it when the Host cannot admit that Run.
      ...(input.queueDeliveryAdmitted === false ? {} : { nextRunId }),
      ...(command.operation === 'queue-edit-begin' ? { validateReplay: replayedBegin } : {}),
      decide: (state) => {
        if (!input.desktopUser) return rejected('follow_up_edit_requires_desktop_user')
        const result = decideEdit(command, state, {
          callerId: input.callerId,
          holdId,
          acquiredAt,
        })
        return result.accepted
          ? { accepted: true, state: result.state, outcome: result.outcome }
          : rejected(result.code)
      },
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
