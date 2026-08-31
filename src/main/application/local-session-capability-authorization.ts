import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import {
  authorizeSessionCapabilities,
  requiredSessionControlCapabilities,
  requiredSessionLifecycleCapabilities,
  requiredSessionQueryCapabilities,
} from '../domain/session-control/session-capability-authorization'
import { LocalSessionCommandAuthorizationError } from '../errors'
import { isUnscopedSessionDiscovery } from './local-session-unscoped-discovery'

type CapabilityAuthorizedPayload = Exclude<
  LocalSessionCommandPayload,
  {
    contract:
      | 'local-ui-v1'
      | 'local-attachments-v1'
      | 'local-compaction-v1'
      | 'local-compaction-cancel-v1'
      | 'session-waggle-v1'
      | 'session-waggle-cancel-v1'
      | 'host-ui-v1'
  }
>

export function authorizeLocalSessionCommandCapabilities(
  caller: LocalSessionCallerIdentity,
  payload: CapabilityAuthorizedPayload,
) {
  if (payload.contract === 'local-access-v1') return Effect.void
  const required =
    payload.contract === 'session-control-v2'
      ? requiredSessionControlCapabilities(payload.request.command)
      : payload.contract === 'session-lifecycle-v2'
        ? requiredSessionLifecycleCapabilities(payload.request.command)
        : requiredSessionQueryCapabilities(payload.request.query)
  const base = authorizeSessionCapabilities(caller.profileAuthority, required)
  const exactDerived =
    !isUnscopedSessionDiscovery(payload) &&
    caller.derivedSessionAuthorities?.some((derived) =>
      required.every((capability) => derived.capabilities.includes(capability)),
    )
  if (base.authorized || exactDerived) return Effect.void
  return Effect.fail(
    new LocalSessionCommandAuthorizationError({
      code: base.code,
      missing: base.missing,
    }),
  )
}
