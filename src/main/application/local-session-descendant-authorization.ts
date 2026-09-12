import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import * as Effect from 'effect/Effect'
import { LocalSessionCommandAuthorizationError } from '../errors'
import {
  type SessionAuthorizationTarget,
  SessionAuthorizationTargetRepository,
} from '../ports/session-authorization-target-repository'
import { authorizeTargetForCaller } from './local-session-derived-authority'

export function authorizeInterruptDescendantTargets(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly ancestor: SessionAuthorizationTarget
  readonly required: readonly SessionCapability[]
}) {
  return Effect.gen(function* () {
    const { sessionId: _, ...hiveOrProjectTarget } = input.ancestor
    const broad = authorizeTargetForCaller(input.caller, hiveOrProjectTarget, input.required)
    if (broad.authorized) return
    const repository = yield* SessionAuthorizationTargetRepository
    const listTargets = repository.listActiveDescendantTargets
    if (!listTargets) {
      return yield* Effect.fail(
        new LocalSessionCommandAuthorizationError({ code: 'target_scope_denied' }),
      )
    }
    const descendants = yield* listTargets(input.ancestor.sessionId)
    const affectedTargets = descendants.length > 0 ? descendants : [input.ancestor]
    for (const target of affectedTargets) {
      const exact = authorizeTargetForCaller(input.caller, target, input.required)
      if (!exact.authorized) {
        return yield* Effect.fail(new LocalSessionCommandAuthorizationError({ code: exact.code }))
      }
    }
  })
}
