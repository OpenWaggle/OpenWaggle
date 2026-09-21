import { isUpdateChannel, type UpdateChannel } from '@shared/types/update-channel'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import { checkForUpdates, getUpdateStatus, installUpdate } from '../updater'
import { typedHandle } from './typed-ipc'

function parseUpdateChannel(value: unknown): UpdateChannel | undefined {
  if (value === undefined || isUpdateChannel(value)) return value
  throw new Error('Invalid update channel')
}

export function registerUpdaterHandlers(): void {
  typedHandle('updater:check', (_event, rawChannel?: unknown) =>
    Effect.sync(() => {
      checkForUpdates(parseUpdateChannel(rawChannel))
    }),
  )

  typedHandle('updater:install', () => Effect.promise(() => installUpdate()))

  typedHandle('updater:get-status', () => Effect.sync(() => getUpdateStatus()))

  typedHandle('app:get-version', () => Effect.sync(() => app.getVersion()))
}
