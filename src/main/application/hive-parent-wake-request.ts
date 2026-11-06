import * as Effect from 'effect/Effect'
import { SessionOrchestrationUpdateDeliveryService } from '../ports/session-orchestration-update-delivery-service'
import type { HiveParentWakeQuery } from '../ports/session-orchestration-update-repository'

/**
 * Asking for a Hive wake (`hive-parent-wake.ts`). Kept apart from the wake itself, which starts
 * Runs through Session Control, so Run coordination can ask without importing that module.
 */
export type HiveParentWakeRequest = HiveParentWakeQuery

let installedHandler: ((request: HiveParentWakeRequest) => void) | null = null

/** The Session Host installs the handler that runs wakes (`hive-parent-wake-installer.ts`). */
export function installHiveParentWakeHandler(handler: (request: HiveParentWakeRequest) => void) {
  installedHandler = handler
  return () => {
    if (installedHandler === handler) installedHandler = null
  }
}

/** Ask the Host to wake `parentSessionId` if it needs it. Never blocks and never fails. */
export function requestHiveParentWake(request: HiveParentWakeRequest) {
  return Effect.sync(() => installedHandler?.(request))
}

/**
 * A Worker update was recorded for `parentSessionId`: deliver it to the parent's active Run, or
 * ask for a wake when no Run took it and the change may wake the parent
 * (`workerChangeMayWakeParent`).
 */
export function notifyParentOfOrchestrationUpdates(
  parentSessionId: string,
  options: { readonly mayWake: boolean } = { mayWake: true },
) {
  return Effect.gen(function* () {
    const delivery = yield* SessionOrchestrationUpdateDeliveryService
    const delivered = yield* delivery.deliverPendingToActiveRun({ parentSessionId })
    if (!delivered && options.mayWake) yield* requestHiveParentWake({ parentSessionId })
  })
}
