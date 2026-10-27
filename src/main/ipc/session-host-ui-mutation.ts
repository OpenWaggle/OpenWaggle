import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { dispatchGuiSessionCommand } from '../application/gui-session-command'

export type LocalUiSessionCommand = Extract<
  LocalSessionCommandPayload,
  { contract: 'local-ui-v1' }
>['request']['command']

export function mutateLocalUiSession(command: LocalUiSessionCommand) {
  return Effect.gen(function* () {
    const result = yield* dispatchGuiSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: process.cwd() },
      payload: {
        contract: 'local-ui-v1',
        request: { requestId: randomUUID(), command },
      },
    })
    if (result.contract !== 'local-ui-v1') {
      return yield* Effect.fail(new Error('Session Host rejected the Local UI mutation.'))
    }
    return result.response
  })
}
