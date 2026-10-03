import { FollowUpId } from '@shared/types/brand'
import type {
  SessionControlMutationResponse,
  SessionControlQueueAdoptMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { adoptFollowUp } from '../domain/session-control/follow-up-adopt'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import {
  type SessionControlMutationDecision,
  SessionControlRepository,
} from '../ports/session-control-repository'

export interface AdoptSessionFollowUpInput {
  readonly callerId: string
  /** The caller is the desktop user without a profile; every other caller is refused. */
  readonly desktopUser: boolean
  readonly hostRunCeiling?: number
  readonly request: SessionControlQueueAdoptMutationRequest
  /** See `MutateSessionQueueInput.queueDeliveryAdmitted`. */
  readonly queueDeliveryAdmitted?: boolean
}

/**
 * Adopts a needs-attention Follow-up as the desktop user (`queue-adopt`), so it resumes under the
 * user's own authority. Journaled and idempotent like every queue mutation. When the adopted
 * Follow-up heads a running queue on an idle Session, the repository starts it.
 */
export function adoptSessionFollowUp(input: AdoptSessionFollowUpInput) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionControlRepository
    const nextRunId = yield* identities.nextRunId
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
      ...(input.queueDeliveryAdmitted === false ? {} : { nextRunId }),
      decide: (state) => {
        if (!input.desktopUser) return rejected('follow_up_adopt_requires_desktop_user')
        const result = adoptFollowUp({
          state,
          followUpId: FollowUpId(command.followUpId),
          callerId: input.callerId,
          expectedQueueRevision: command.expectedQueueRevision,
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
