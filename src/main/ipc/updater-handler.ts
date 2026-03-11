import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { checkForUpdates, getUpdateStatus, installUpdate } from '../updater'
import { typedHandle } from './typed-ipc'

export function registerUpdaterHandlers(): void {
  typedHandle('updater:check', () =>
    Effect.sync(() => {
      checkForUpdates()
    }),
  )

  typedHandle('updater:install', () =>
    Effect.sync(() => {
      installUpdate()
    }),
  )

  typedHandle('updater:get-status', () => Effect.sync(() => getUpdateStatus()))

  typedHandle('app:get-version', () => Effect.sync(() => app.getVersion()))
}
