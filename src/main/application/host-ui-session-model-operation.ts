import * as Effect from 'effect/Effect'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import {
  invalid,
  requireArgCount,
  validateOptionalModel,
  validateSessionId,
} from './host-ui-session-operation-validation'

const TWO_ARGUMENTS = 2

/**
 * Switches the durable model of an existing Session.
 *
 * Every Run resolves its model from the Session's execution profile when it starts, so the switch
 * never reaches a Run that is already streaming: it applies to the next Run, whether that Run comes
 * from the composer, a queued follow-up, or another Session Control caller. Classic and Waggle Runs
 * share this rule. The per-project preferred model for new Sessions is deliberately not touched.
 */
export function setSessionModel(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, TWO_ARGUMENTS)
    const sessionId = yield* validateSessionId(args[0])
    const model = yield* validateOptionalModel(args[1])
    if (!model) return yield* invalid('Session model is required.')
    const switched = yield* (yield* SessionProjectionRepository).setExecutionModel(sessionId, model)
    if (!switched) {
      return yield* invalid('Session has no execution profile whose model can be switched.')
    }
    publishSessionHostEvent({ kind: 'session-list-changed', sessionId, change: 'updated' })
  })
}
