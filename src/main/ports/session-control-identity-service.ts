import type { FollowUpId, ReportCorrelationId, ReportId, RunId } from '@shared/types/brand'
import { Context, type Effect } from 'effect'

export interface SessionControlIdentityServiceShape {
  readonly nextRunId: Effect.Effect<RunId>
  readonly nextFollowUpId: Effect.Effect<FollowUpId>
  readonly nextReportId: Effect.Effect<ReportId>
  readonly nextReportCorrelationId: Effect.Effect<ReportCorrelationId>
  readonly now: Effect.Effect<number>
}

export class SessionControlIdentityService extends Context.Tag(
  '@openwaggle/SessionControlIdentityService',
)<SessionControlIdentityService, SessionControlIdentityServiceShape>() {}
