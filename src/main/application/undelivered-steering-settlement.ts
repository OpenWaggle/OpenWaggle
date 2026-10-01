import type { RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import type { UndeliveredSteer } from '../domain/session-control/undelivered-steering'
import { AgentSteeringService } from '../ports/agent-steering-service'

/**
 * The steers an ended Run never incorporated. A runtime without live steering has none; the
 * service is optional so lifecycle-only runtimes (and their tests) need not provide it.
 */
export function takeUndeliveredSteers(runId: RunId) {
  return Effect.serviceOption(AgentSteeringService).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed<readonly UndeliveredSteer[]>([]),
        onSome: (steering) => steering.takeUndelivered(runId),
      }),
    ),
  )
}
