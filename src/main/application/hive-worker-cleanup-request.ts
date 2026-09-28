import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { HiveWorkerCleanup } from '../ports/hive-worker-cleanup'

/**
 * Ask the Session Host to run a Hive cleanup pass for `sessionId`, if the runtime provides one.
 * Callers stay independent of the archive machinery and never fail because of cleanup.
 */
export function requestHiveWorkerCleanup(sessionId: SessionId) {
  return Effect.serviceOption(HiveWorkerCleanup).pipe(
    Effect.flatMap((cleanup) =>
      Option.isSome(cleanup) ? cleanup.value.requestReconciliation(sessionId) : Effect.void,
    ),
  )
}
