import type { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { UndeliveredSteer } from '../domain/session-control/undelivered-steering'
import { AgentSteeringService } from '../ports/agent-steering-service'
import type { SessionControlRunSettlementResult } from '../ports/session-control-run-lifecycle-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'

/**
 * Settle an ended Run with the steers it never incorporated. The runtime keeps them until this
 * settlement succeeds, so a settlement that fails leaves them for a retry instead of losing them.
 * A Run a replacement already displaced is rejected, but its steers still reach the queue; that
 * change is published here because the caller publishes only accepted settlements.
 */
export function settleWithUndeliveredSteers<E, R>(input: {
  readonly sessionId: SessionId
  readonly runId: RunId
  readonly settle: (
    undeliveredSteers: readonly UndeliveredSteer[],
  ) => Effect.Effect<SessionControlRunSettlementResult, E, R>
}) {
  return Effect.gen(function* () {
    const steering = yield* AgentSteeringService
    const undeliveredSteers = yield* steering.readUndelivered(input.runId)
    const settlement = yield* input.settle(undeliveredSteers)
    yield* steering.forgetUndelivered(input.runId)
    if (!settlement.accepted && settlement.stateRevision !== undefined) {
      publishSessionHostEvent({
        kind: 'session-state-changed',
        sessionId: input.sessionId,
        stateRevision: settlement.stateRevision,
        operation: 'steers-returned',
        runId: input.runId,
      })
    }
    return settlement
  })
}
