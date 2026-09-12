import type { DesktopServiceRequest } from '@shared/types/desktop-service'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { LOCAL_SESSION_DESKTOP_SERVICE_REVISION } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { DesktopServiceBroker } from '../ports/desktop-service-broker'

export function dispatchDesktopServiceRequest(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly request: DesktopServiceRequest
  readonly negotiatedRevision?: number
}) {
  return Effect.gen(function* () {
    if (input.caller.callerId !== 'gui:local-user' || input.caller.profileAuthority !== undefined) {
      return yield* Effect.fail(
        new Error('Desktop services require the authenticated GUI Local-user identity.'),
      )
    }
    if (
      input.negotiatedRevision !== undefined &&
      input.negotiatedRevision < LOCAL_SESSION_DESKTOP_SERVICE_REVISION
    ) {
      return yield* Effect.fail(
        new Error('Desktop services require Local Session protocol revision 11.'),
      )
    }
    const broker = yield* DesktopServiceBroker
    const response = yield* broker.handleGuiRequest(input.request)
    return { contract: 'desktop-service-v1' as const, response }
  })
}
