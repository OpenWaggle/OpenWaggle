import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { authorizeLocalSessionCommand } from './local-session-command-authorization'
import {
  canonicalizeNamedProfileProjectPayload,
  scopeNamedProfileExport,
} from './local-session-command-scoping'
import {
  acquireLocalSessionMutationAdmission,
  type LocalSessionMutationAdmission,
} from './local-session-mutation-admission'
import { isLocallyHandledCommand } from './local-session-owned-command'
import { prepareSessionCommandAttachments } from './session-command-attachment-preparation'

type LocalSessionMutationPayload = Extract<
  LocalSessionCommandPayload,
  { readonly contract: 'session-control-v2' | 'session-lifecycle-v2' }
>

export function acquirePreparedLocalSessionMutation(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalSessionMutationPayload
  readonly mutationAdmission?: () => Promise<LocalSessionMutationAdmission>
}) {
  return Effect.gen(function* () {
    const admission = yield* acquireLocalSessionMutationAdmission(input, input.caller)
    return yield* Effect.gen(function* () {
      const caller = admission.caller
      const canonicalPayload = yield* canonicalizeNamedProfileProjectPayload(caller, input.payload)
      if (
        canonicalPayload.contract !== 'session-control-v2' &&
        canonicalPayload.contract !== 'session-lifecycle-v2'
      ) {
        return yield* Effect.die('Non-mutation canonicalization changed its contract.')
      }
      yield* authorizeLocalSessionCommand({ caller, payload: canonicalPayload })
      const scopedPayload = yield* scopeNamedProfileExport(caller, canonicalPayload)
      if (
        scopedPayload.contract !== 'session-control-v2' &&
        scopedPayload.contract !== 'session-lifecycle-v2'
      ) {
        return yield* Effect.die('Mutation scoping changed its contract.')
      }
      const payload = yield* prepareSessionCommandAttachments({
        payload: scopedPayload,
        caller,
        ...(caller.workingDirectory ? { workingDirectory: caller.workingDirectory } : {}),
      })
      if (isLocallyHandledCommand(payload) || payload.contract === 'host-ui-v1') {
        return yield* Effect.die('Mutation preparation changed its contract.')
      }
      if (
        payload.contract !== 'session-control-v2' &&
        payload.contract !== 'session-lifecycle-v2'
      ) {
        return yield* Effect.die('Mutation preparation changed its contract.')
      }
      return { caller, payload, release: admission.release }
    }).pipe(Effect.onError(() => Effect.sync(admission.release)))
  })
}
