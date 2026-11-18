import * as Effect from 'effect/Effect'
import { requireArgCount, validateSessionId } from './host-ui-session-operation-validation'
import { runSessionTitleRegeneration } from './session-title-scheduler'

/** `sessions:regenerate-title`: a user-requested Title regeneration, applied directly. */
export function regenerateSessionTitleOperation(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const sessionId = yield* validateSessionId(args[0])
    return yield* Effect.promise(() => runSessionTitleRegeneration(sessionId))
  })
}
