import { randomUUID } from 'node:crypto'
import { FollowUpId, ReportCorrelationId, ReportId, RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionControlIdentityService } from '../ports/session-control-identity-service'

export const SessionControlIdentityServiceLive = Layer.succeed(SessionControlIdentityService, {
  nextRunId: Effect.sync(() => RunId(randomUUID())),
  nextFollowUpId: Effect.sync(() => FollowUpId(randomUUID())),
  nextReportId: Effect.sync(() => ReportId(randomUUID())),
  nextReportCorrelationId: Effect.sync(() => ReportCorrelationId(randomUUID())),
  now: Effect.sync(() => Date.now()),
})
