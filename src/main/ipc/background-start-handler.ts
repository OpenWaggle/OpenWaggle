import * as Effect from 'effect/Effect'
import { readBackgroundStart, writeBackgroundStart } from '../background-start'
import { typedHandle } from './typed-ipc'

/** Background start (ADR 0057): the login item that starts only the Session Host. */
export function registerBackgroundStartHandlers(): void {
  typedHandle('app:get-background-start', () => Effect.promise(readBackgroundStart))
  typedHandle('app:set-background-start', (_event, enabled: boolean) =>
    Effect.promise(() => writeBackgroundStart(enabled === true)),
  )
}
