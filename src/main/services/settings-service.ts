import type { Settings } from '@shared/types/settings'
import { Context, Effect, Layer } from 'effect'

export interface SettingsServiceShape {
  readonly get: () => Effect.Effect<Settings>
  readonly update: (partial: Partial<Settings>) => Effect.Effect<void>
  readonly initialize: () => Effect.Effect<void>
  readonly flushForTests: () => Effect.Effect<void>
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
      updateSettingsDurably,
      initializeSettingsStore,
      refreshSettingsStore,
      flushSettingsStoreForTests,
    } = await import('../store/settings')
    return Layer.succeed(SettingsService, {
      get: () =>
        Effect.promise(async () => {
          await refreshSettingsStore()
          return getSettings()
        }),
      update: (partial) => Effect.promise(() => updateSettingsDurably(partial)),
      initialize: () => Effect.promise(() => initializeSettingsStore()),
      flushForTests: () => Effect.promise(() => flushSettingsStoreForTests()),
    } satisfies SettingsServiceShape)
  }).pipe(Layer.unwrapEffect)
}
