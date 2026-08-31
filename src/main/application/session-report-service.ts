import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type {
  SessionControlMutationResponse,
  SessionControlReportMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'
import { SessionReportDeliveryService } from '../ports/session-report-delivery-service'
import { SessionReportRepository } from '../ports/session-report-repository'

export function submitSessionReport(input: {
  readonly callerId: string
  readonly authority?: LocalSessionProfileAuthority
  readonly request: SessionControlReportMutationRequest
}) {
  return Effect.gen(function* () {
    const identities = yield* SessionControlIdentityService
    const repository = yield* SessionReportRepository
    const delivery = yield* SessionReportDeliveryService
    const reportId = yield* identities.nextReportId
    const correlationId = yield* identities.nextReportCorrelationId
    const now = yield* identities.now
    const response = yield* repository.execute({
      callerId: input.callerId,
      ...(input.authority ? { authority: input.authority } : {}),
      request: input.request,
      reportId,
      correlationId,
      now,
    })
    if (!response.replayed && response.outcome.effect === 'accepted-report') {
      yield* Effect.forEach(
        response.outcome.targetSessionIds,
        (targetSessionId) => delivery.deliverPendingToActiveRun({ targetSessionId }),
        { discard: true },
      )
    }
    return response satisfies SessionControlMutationResponse
  })
}
