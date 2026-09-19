import type { Settings } from '@shared/types/settings'
import { Context, Effect, Layer } from 'effect'
import { SettingsStoreReadError } from '../errors'
import { isAppDatabaseClientIsolated } from './database-service'

export interface SettingsServiceShape {
  readonly get: () => Effect.Effect<Settings, SettingsStoreReadError>
  readonly update: (partial: Partial<Settings>) => Effect.Effect<void, Error>
  readonly setSkillEnabled?: (
    projectPath: string,
    skillId: string,
    enabled: boolean,
  ) => Effect.Effect<void, Error>
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
      updateSettingsDurably,
      updateSkillToggleDurably,
      initializeSettingsStore,
      refreshSettingsStore,
      hydrateSettingsStoreFromHost,
      flushSettingsStoreForTests,
    } = await import('../store/settings')
    const readSettings = async () => {
      if (isAppDatabaseClientIsolated()) {
        // Native browser access must observe revocations made by any Host client.
        const { invokeConfiguredHostUi } = await import('../application/gui-session-command-router')
        const remote = await invokeConfiguredHostUi('settings:get', [])
        if (!remote.handled) throw new Error('Attached GUI lost its Session Host settings route.')
        hydrateSettingsStoreFromHost(remote.result)
      } else {
        await initializeSettingsStore()
        await refreshSettingsStore()
      }
      return getSettings()
    }
    return Layer.succeed(SettingsService, {
      get: () => Effect.tryPromise({ try: readSettings, catch: toSettingsReadError }),
      update: (partial) =>
        Effect.tryPromise({
          try: async () => {
            await readSettings()
            await updateSettingsDurably(partial)
          },
          catch: toError,
        }),
      setSkillEnabled: (projectPath, skillId, enabled) =>
        Effect.tryPromise({
          try: async () => {
            await readSettings()
            await updateSkillToggleDurably(projectPath, skillId, enabled)
          },
          catch: toError,
        }),
      initialize: () =>
        Effect.tryPromise({
          try: async () => {
            if (!isAppDatabaseClientIsolated()) await initializeSettingsStore()
            getSettings()
          },
          catch: toSettingsReadError,
        }),
      flushForTests: () =>
        Effect.tryPromise({ try: () => flushSettingsStoreForTests(), catch: toError }),
    } satisfies SettingsServiceShape)
  }).pipe(Layer.unwrapEffect)
}
