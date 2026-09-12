import { Context, type Effect } from 'effect'

export interface SessionReportDeliveryServiceShape {
  readonly deliverPendingToActiveRun: (input: {
    readonly targetSessionId: string
  }) => Effect.Effect<boolean>
}

export class SessionReportDeliveryService extends Context.Tag(
  '@openwaggle/SessionReportDeliveryService',
)<SessionReportDeliveryService, SessionReportDeliveryServiceShape>() {}
