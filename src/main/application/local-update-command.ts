import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import {
  LOCAL_UPDATE_CONTRACT_VERSION,
  type LocalUpdateCommandPayload,
} from '@shared/types/local-update'
import * as Effect from 'effect/Effect'
import { LocalSessionCommandAuthorizationError } from '../errors'
import { SettingsService } from '../services/settings-service'

function authorizeLocalUpdateCaller(caller: LocalSessionCallerIdentity) {
  if (caller.profileAuthority || !caller.callerId.startsWith('local-user:')) {
    return Effect.fail(new LocalSessionCommandAuthorizationError({ code: 'capability_denied' }))
  }
  return Effect.void
}

export function dispatchLocalUpdateCommand(input: {
  readonly caller: LocalSessionCallerIdentity
  readonly payload: LocalUpdateCommandPayload
}) {
  return Effect.gen(function* () {
    yield* authorizeLocalUpdateCaller(input.caller)
    const settings = yield* SettingsService
    const request = input.payload.request
    if (request.operation === 'set-channel') {
      yield* settings.update({ updateChannel: request.channel })
      return {
        contract: 'local-update-v1' as const,
        response: {
          contractVersion: LOCAL_UPDATE_CONTRACT_VERSION,
          updateChannel: request.channel,
        },
      }
    }
    const snapshot = yield* settings.get()
    return {
      contract: 'local-update-v1' as const,
      response: {
        contractVersion: LOCAL_UPDATE_CONTRACT_VERSION,
        updateChannel: snapshot.updateChannel,
      },
    }
  })
}
