import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import type { SessionQuery } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { requiredSessionQueryCapabilities } from '../domain/session-control/session-capability-authorization'
import { LocalSessionCommandAuthorizationError } from '../errors'
import { SessionAuthorizationTargetRepository } from '../ports/session-authorization-target-repository'
import { authorizeTargetForCaller } from './local-session-derived-authority'

/** The Sessions a catalog query filters by: `--parent` and `--worker`. */
function filterSessionIds(query: SessionQuery): readonly string[] {
  if (query.operation === 'delegations-list' || query.operation === 'delegations-conflicts') {
    return [query.parentSessionId, query.workerSessionId].filter(
      (sessionId): sessionId is string => sessionId !== undefined,
    )
  }
  // `list --parent` (#352) names its Queen the same way. Read structurally, so this holds
  // whether or not the list query declares the field yet.
  if (query.operation === 'list' && 'parentSessionId' in query) {
    const parentSessionId: unknown = query.parentSessionId
    return typeof parentSessionId === 'string' ? [parentSessionId] : []
  }
  return []
}

/**
 * `list --parent`, and `delegations-list` and `delegations-conflicts` with `--parent` or
 * `--worker`, name Sessions, so they answer like `read` for those Sessions: `target_scope_denied`
 * outside the caller's scope and `session_not_found` for an unknown one, not an empty page that
 * reads as "nothing here" (#351).
 */
export function authorizeDelegationFilterTargets(
  caller: LocalSessionCallerIdentity,
  payload: LocalSessionCommandPayload,
) {
  if (payload.contract !== 'session-query-v2') return Effect.void
  const query = payload.request.query
  const sessionIds = filterSessionIds(query)
  if (sessionIds.length === 0) return Effect.void
  return Effect.gen(function* () {
    const repository = yield* SessionAuthorizationTargetRepository
    for (const sessionId of sessionIds) {
      const target = yield* repository.resolve(sessionId)
      const authorization = authorizeTargetForCaller(
        caller,
        target,
        requiredSessionQueryCapabilities(query),
      )
      if (!authorization.authorized) {
        return yield* Effect.fail(
          new LocalSessionCommandAuthorizationError({ code: authorization.code }),
        )
      }
    }
  })
}
