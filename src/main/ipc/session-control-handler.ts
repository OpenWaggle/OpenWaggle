import { decodeSessionControlMutationRequest } from '@shared/schemas/session-control'
import { decodeSessionQueryRequest } from '@shared/schemas/session-query'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { dispatchLocalSessionCommand } from '../application/local-session-command-dispatcher'
import { typedHandle } from './typed-ipc'

function dispatchGuiCommand(payload: LocalSessionCommandPayload) {
  return dispatchLocalSessionCommand({
    caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
    payload,
  })
}

export function registerSessionControlHandlers() {
  typedHandle('session-control:mutate', (_event, rawRequest) =>
    Effect.gen(function* () {
      const request = decodeSessionControlMutationRequest(rawRequest)
      const result = yield* dispatchGuiCommand({ contract: 'session-control-v2', request })
      if (result.contract !== 'session-control-v2') {
        return yield* Effect.die(new Error('Session Control returned the wrong contract.'))
      }
      return result.response
    }),
  )

  typedHandle('session-control:query', (_event, rawRequest) =>
    Effect.gen(function* () {
      const request = decodeSessionQueryRequest(rawRequest)
      const result = yield* dispatchGuiCommand({ contract: 'session-query-v2', request })
      if (result.contract !== 'session-query-v2') {
        return yield* Effect.die(new Error('Session query returned the wrong contract.'))
      }
      return result.response
    }),
  )
}
