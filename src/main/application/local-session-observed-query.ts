import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { canonicalizeNamedProfileProjectPayload } from './local-session-command-scoping'
import {
  acquireLocalSessionObservationAdmission,
  type LocalSessionObservationAdmission,
} from './local-session-mutation-admission'
import {
  dispatchSessionRepositoryQuery,
  dispatchSessionRequestsListQuery,
  dispatchSessionWaitQuery,
  observeSessionQueryWithSignal,
} from './local-session-query-dispatcher'

type SessionQueryPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'session-query-v2' }
>

function mergeAbortSignals(first: AbortSignal | undefined, second: AbortSignal | undefined) {
  if (!first) return second
  if (!second) return first
  return AbortSignal.any([first, second])
}

export function dispatchObservedLocalSessionQuery(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: SessionQueryPayload
  readonly signal?: AbortSignal
  readonly observationAdmission?: () => Promise<LocalSessionObservationAdmission>
}) {
  return Effect.gen(function* () {
    const admission = yield* acquireLocalSessionObservationAdmission(input, input.caller)
    const signal = mergeAbortSignals(admission.signal, input.signal)
    const observation = Effect.gen(function* () {
      const payload = yield* canonicalizeNamedProfileProjectPayload(admission.caller, input.payload)
      if (payload.contract !== 'session-query-v2') {
        return yield* Effect.die('Session query canonicalization changed its contract.')
      }
      const query = payload.request.query
      if (query.operation === 'wait' || query.operation === 'exports-wait') {
        return yield* dispatchSessionWaitQuery(
          admission.caller,
          payload,
          signal,
          admission.refreshCaller,
        )
      }
      if (query.operation === 'requests-list') {
        return yield* dispatchSessionRequestsListQuery(
          admission.caller,
          payload,
          signal,
          admission.refreshCaller,
        )
      }
      return yield* dispatchSessionRepositoryQuery(
        admission.caller,
        payload,
        signal,
        admission.refreshCaller,
      )
    })
    return yield* observeSessionQueryWithSignal(observation, signal).pipe(
      Effect.ensuring(Effect.sync(admission.release)),
    )
  })
}
