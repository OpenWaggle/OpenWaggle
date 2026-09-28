import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { DesktopServiceBroker } from '../ports/desktop-service-broker'
import { TerminalService } from '../ports/terminal-service'
import { withSessionActionRelease } from './action-workspace-release'
import {
  acquireSessionRemovalAdmission,
  cancelSessionRuns,
  waitForSessionRuns,
} from './active-session-runs'

const SESSION_REMOVAL_SETTLE_TIMEOUT_MS = 30_000

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Hold both Host writer admission and the GUI's native-owner fence until mutation settles.
 * `admit` runs inside the fence, before any terminal, browser, or service teardown, so it can
 * refuse (by failing) on desktop state that no new admission can add while it is checked.
 */
export function withSessionDesktopRemoval<A, E, R, AE = never, AR = never>(
  sessionId: SessionId,
  operation: Effect.Effect<A, E, R>,
  intent: 'archive' | 'delete' = 'archive',
  admit: Effect.Effect<void, AE, AR> = Effect.void,
) {
  return Effect.acquireUseRelease(
    Effect.try({ try: () => acquireSessionRemovalAdmission(sessionId), catch: toError }),
    (admission) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => cancelSessionRuns(sessionId))
        const settled = yield* Effect.tryPromise({
          try: () => waitForSessionRuns(sessionId, SESSION_REMOVAL_SETTLE_TIMEOUT_MS),
          catch: toError,
        })
        if (!settled) {
          return yield* Effect.fail(
            new Error(
              `Session work did not stop within ${String(SESSION_REMOVAL_SETTLE_TIMEOUT_MS)} ms. The session was left unchanged.`,
            ),
          )
        }
        return yield* Effect.acquireUseRelease(
          Effect.try({ try: () => admission.reserveTreeMutation(), catch: toError }),
          () =>
            Effect.gen(function* () {
              const terminals = yield* TerminalService
              const desktop = yield* DesktopServiceBroker
              return yield* terminals.runWithMutationFence(
                { kind: 'owner', ownerKey: sessionId },
                Effect.gen(function* () {
                  yield* admit
                  yield* terminals.closeAllForOwner(sessionId, false)
                  yield* desktop.execute({
                    service: 'browser',
                    operation: 'deleteOwner',
                    ownerKey: sessionId,
                  })
                  return yield* withSessionActionRelease(sessionId, operation, 'before', intent)
                }),
              )
            }),
          (writer) => Effect.sync(writer.release),
        )
      }),
    (admission) => Effect.sync(admission.release),
  )
}
