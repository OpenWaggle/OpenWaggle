import { Context, type Effect } from 'effect'

export interface SessionOrchestrationUpdateDeliveryServiceShape {
  readonly deliverPendingToActiveRun: (input: {
    readonly parentSessionId: string
  }) => Effect.Effect<boolean>
  readonly deliverPendingSpecificationsToActiveRun: (input: {
    readonly workerSessionId: string
  }) => Effect.Effect<boolean>
}

export class SessionOrchestrationUpdateDeliveryService extends Context.Tag(
  '@openwaggle/SessionOrchestrationUpdateDeliveryService',
)<SessionOrchestrationUpdateDeliveryService, SessionOrchestrationUpdateDeliveryServiceShape>() {}
