import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import * as Effect from 'effect/Effect'
import { LocalSessionCommandAuthorizationError } from '../errors'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import type { ActiveDescendantRun } from '../ports/session-descendant-run-repository'
import { authorizeTargetForCaller } from './local-session-derived-authority'

export function authorizeDescendantInterruptionSnapshot(input: {
  readonly caller?: LocalSessionCallerIdentity
  readonly ancestorSessionId: string
  readonly descendants: readonly ActiveDescendantRun[]
}) {
  if (!input.caller) return Effect.void
  const caller = input.caller
  return Effect.gen(function* () {
    const targets = yield* SessionAuthorizationTargetRepository
    const ancestor = yield* targets.resolve(input.ancestorSessionId)
    const { sessionId: _, ...hiveOrProjectTarget } = ancestor
    const broad = authorizeTargetForCaller(caller, hiveOrProjectTarget, ['sessions:interrupt'])
    if (broad.authorized) return
    for (const descendant of input.descendants) {
      const target = yield* targets.resolve(descendant.sessionId)
      const exact = authorizeTargetForCaller(caller, target, ['sessions:interrupt'])
      if (!exact.authorized) {
        return yield* Effect.fail(new LocalSessionCommandAuthorizationError({ code: exact.code }))
      }
    }
  })
}
