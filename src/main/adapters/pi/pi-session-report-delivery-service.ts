import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { activeRuns } from '../../application/active-session-runs'
import { SessionReportDeliveryService } from '../../ports/session-report-delivery-service'
import { SessionReportRepository } from '../../ports/session-report-repository'
import { deliverPeerAgentReports } from './peer-agent-report-extension'

export const PiSessionReportDeliveryServiceLive = Layer.effect(
  SessionReportDeliveryService,
  Effect.gen(function* () {
    const repository = yield* SessionReportRepository
    return SessionReportDeliveryService.of({
      deliverPendingToActiveRun: ({ targetSessionId }) =>
        Effect.gen(function* () {
          const active = activeRuns.get(SessionId(targetSessionId))
          if (!active) return false
          const reports = yield* repository.listPending({ targetSessionId })
          return deliverPeerAgentReports(active.metadata.runId, reports)
        }).pipe(Effect.catchAll(() => Effect.succeed(false))),
    })
  }),
)
