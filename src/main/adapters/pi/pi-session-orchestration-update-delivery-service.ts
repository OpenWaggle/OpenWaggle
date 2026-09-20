import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { activeRuns } from '../../application/active-session-runs'
import { SessionOrchestrationUpdateDeliveryService } from '../../ports/session-orchestration-update-delivery-service'
import { SessionOrchestrationUpdateRepository } from '../../ports/session-orchestration-update-repository'
import { deliverDelegationSpecificationUpdates } from './delegation-specification-update-extension'
import { deliverOrchestrationUpdates } from './orchestration-update-extension'

export const PiSessionOrchestrationUpdateDeliveryServiceLive = Layer.effect(
  SessionOrchestrationUpdateDeliveryService,
  Effect.gen(function* () {
    const repository = yield* SessionOrchestrationUpdateRepository
    return SessionOrchestrationUpdateDeliveryService.of({
      deliverPendingToActiveRun: ({ parentSessionId }) =>
        Effect.gen(function* () {
          const active = activeRuns.get(SessionId(parentSessionId))
          if (!active) return false
          const updates = yield* repository.listPending({ parentSessionId })
          return deliverOrchestrationUpdates(active.metadata.runId, updates)
        }).pipe(Effect.catchAll(() => Effect.succeed(false))),
      deliverPendingSpecificationsToActiveRun: ({ workerSessionId }) =>
        Effect.gen(function* () {
          const active = activeRuns.get(SessionId(workerSessionId))
          if (!active) return false
          const updates = yield* repository.listPendingSpecifications({ workerSessionId })
          return deliverDelegationSpecificationUpdates(active.metadata.runId, updates)
        }).pipe(Effect.catchAll(() => Effect.succeed(false))),
    })
  }),
)
