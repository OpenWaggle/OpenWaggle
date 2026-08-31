import type { Settings } from '@shared/types/settings'
import { Context, Effect, Layer } from 'effect'
import { isAppDatabaseClientIsolated } from './database-service'

export interface SettingsServiceShape {
  readonly get: () => Effect.Effect<Settings>
  readonly update: (partial: Partial<Settings>) => Effect.Effect<void>
  readonly setSkillEnabled?: (
    projectPath: string,
    skillId: string,
    enabled: boolean,
  ) => Effect.Effect<void>
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
      updateSkillToggleDurably,
      initializeSettingsStore,
      refreshSettingsStore,
      flushSettingsStoreForTests,
    } = await import('../store/settings')
    return Layer.succeed(SettingsService, {
      get: () =>
        Effect.promise(async () => {
          if (!isAppDatabaseClientIsolated()) await refreshSettingsStore()
          return getSettings()
        }),
      update: (partial) => Effect.promise(() => updateSettingsDurably(partial)),
      setSkillEnabled: (projectPath, skillId, enabled) =>
        Effect.promise(() => updateSkillToggleDurably(projectPath, skillId, enabled)),
      initialize: () => Effect.promise(() => initializeSettingsStore()),
      flushForTests: () => Effect.promise(() => flushSettingsStoreForTests()),
    } satisfies SettingsServiceShape)
  }).pipe(Layer.unwrapEffect)
}
