import * as Effect from 'effect/Effect'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { mutateLocalUiSession } from './host-ui-session-lifecycle-operations'
import {
  requireArgCount,
  validatePinnedSessionMove,
  validateSessionId,
} from './host-ui-session-operation-validation'

/** Host UI argument adapters for the Pinned sessions channels (`sessions:pins:*`). */
export function listPinnedSessions(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 0)
    return [...(yield* (yield* SessionProjectionRepository).listPinnedSessions())]
  })
}

export function setSessionPinned(
  channel: 'sessions:pins:pin' | 'sessions:pins:unpin',
  args: readonly unknown[],
) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const sessionId = yield* validateSessionId(args[0])
    return yield* mutateLocalUiSession({
      operation: channel === 'sessions:pins:pin' ? 'pin' : 'unpin',
      sessionId,
    })
  })
}

export function movePinnedSession(args: readonly unknown[]) {
  return Effect.gen(function* () {
    yield* requireArgCount(args, 1)
    const move = yield* validatePinnedSessionMove(args[0])
    return yield* mutateLocalUiSession({ operation: 'move-pin', ...move })
  })
}
