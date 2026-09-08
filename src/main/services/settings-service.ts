import type { Settings } from '@shared/types/settings'
import { Context, Effect, Layer } from 'effect'
import { SettingsStoreReadError } from '../errors'

export interface SettingsServiceShape {
  readonly get: () => Effect.Effect<Settings, SettingsStoreReadError>
  readonly update: (partial: Partial<Settings>) => Effect.Effect<void, Error>
  readonly initialize: () => Effect.Effect<void, SettingsStoreReadError>
  readonly flushForTests: () => Effect.Effect<void, Error>
}

function toSettingsReadError(cause: unknown) {
  return cause instanceof SettingsStoreReadError
    ? cause
    : new SettingsStoreReadError({
        operation: 'read',
        message: 'OpenWaggle could not read saved settings.',
        cause,
      })
}

function toError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}

export class SettingsService extends Context.Tag('@openwaggle/SettingsService')<
  SettingsService,
  SettingsServiceShape
>() {
  // Dynamic import defers settings.ts module-level side effects (electron.safeStorage)
  // until runtime initialization, preventing test breakage in unrelated suites.
  static readonly Live = Effect.promise(async () => {
    const {
      getSettings,
      updateSettings,
      updateSettingsDurably,
      initializeSettingsStore,
      flushSettingsStoreForTests,
    } = await import('../store/settings')
    const readSettings = async () => {
      await initializeSettingsStore()
      return getSettings()
    }
    return Layer.succeed(SettingsService, {
      get: () =>
        Effect.tryPromise({
          try: readSettings,
          catch: toSettingsReadError,
        }),
      update: (partial) =>
        Effect.tryPromise({
          try: async () => {
            await readSettings()
            if (partial.browserProfiles === undefined) {
              updateSettings(partial)
              return
            }
            await updateSettingsDurably(partial)
          },
          catch: toError,
        }),
      initialize: () =>
        Effect.tryPromise({
          try: async () => {
            await initializeSettingsStore()
            getSettings()
          },
          catch: toSettingsReadError,
        }),
      flushForTests: () =>
        Effect.tryPromise({
          try: () => flushSettingsStoreForTests(),
          catch: toError,
        }),
    } satisfies SettingsServiceShape)
  }).pipe(Layer.unwrapEffect)
}
