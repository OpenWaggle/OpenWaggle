import * as Effect from 'effect/Effect'
import type { dispatchLocalSessionCommand } from './local-session-command-dispatcher'

/**
 * Sends a command through the Local Session dispatcher from an operation it dispatches (a Host UI
 * request). The dispatcher is loaded on first use, as importing it would be a cycle.
 */
export function dispatchNestedLocalSessionCommand(
  input: Parameters<typeof dispatchLocalSessionCommand>[0],
) {
  return Effect.gen(function* () {
    const dispatcher = yield* Effect.promise(() => import('./local-session-command-dispatcher'))
    return yield* dispatcher.dispatchLocalSessionCommand(input)
  })
}
