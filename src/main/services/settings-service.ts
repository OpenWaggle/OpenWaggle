import type { McpServerConfig } from '@shared/types/mcp'
import type { Settings } from '@shared/types/settings'
import { Context, Effect, Layer } from 'effect'

export interface SettingsServiceShape {
  readonly get: () => Effect.Effect<Settings>
  readonly update: (partial: Partial<Settings>) => Effect.Effect<void>
  /** Atomically read-transform-write the mcpServers array (no interleaving). */
  readonly transformMcpServers: (
    fn: (servers: readonly McpServerConfig[]) => readonly McpServerConfig[],
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
      updateSettings,
      transformMcpServers,
      initializeSettingsStore,
      flushSettingsStoreForTests,
    } = await import('../store/settings')
    return Layer.succeed(SettingsService, {
      get: () => Effect.sync(() => getSettings()),
      update: (partial) => Effect.sync(() => updateSettings(partial)),
      transformMcpServers: (fn) => Effect.sync(() => transformMcpServers(fn)),
      initialize: () => Effect.promise(() => initializeSettingsStore()),
      flushForTests: () => Effect.promise(() => flushSettingsStoreForTests()),
    } satisfies SettingsServiceShape)
  }).pipe(Layer.unwrapEffect)
}
