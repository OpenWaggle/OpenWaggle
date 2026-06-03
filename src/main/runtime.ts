import * as NodeContext from '@effect/platform-node/NodeContext'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import type { Exit as ExitType } from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { ExtensionBuildRunnerLive } from './adapters/extension-build-runner'
import { FilesystemExtensionManagerLive } from './adapters/filesystem-extension-manager-service'
import { PiAgentKernelLive } from './adapters/pi/pi-agent-kernel-adapter'
import { PiMcpConfigServiceLive } from './adapters/pi/pi-mcp-config-service'
import { PiProviderAuthLive } from './adapters/pi/pi-provider-auth-service'
import { PiProviderOAuthLive } from './adapters/pi/pi-provider-oauth-service'
import { PiProviderProbeLive } from './adapters/pi/pi-provider-probe-adapter'
import { ProviderServiceLive } from './adapters/pi/pi-provider-service'
import { PiSessionTreePreferencesLive } from './adapters/pi/pi-session-tree-preferences-service'
import { SettingsWagglePresetsRepositoryLive } from './adapters/settings-waggle-presets-repository'
import { SqliteExtensionLifecycleRepositoryLive } from './adapters/sqlite-extension-lifecycle-repository'
import { SqliteExtensionProjectOverridesRepositoryLive } from './adapters/sqlite-extension-project-overrides-repository'
import { SqliteExtensionStorageRepositoryLive } from './adapters/sqlite-extension-storage-repository'
import { SqliteSessionProjectionRepositoryLive } from './adapters/sqlite-session-projection-repository'
import { SqliteSessionRepositoryLive } from './adapters/sqlite-session-repository'
import { FilesystemStandardsLive } from './adapters/standards-adapter'
import { AppDatabaseLive } from './services/database-service'
import { AppLogger } from './services/logger-service'
import { SettingsService } from './services/settings-service'
import { setStoreEffectRunner } from './store/store-runtime'

const ExtensionLifecycleRepositoryLive = SqliteExtensionLifecycleRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const ExtensionProjectOverridesRepositoryLive = SqliteExtensionProjectOverridesRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const ExtensionStorageRepositoryLive = SqliteExtensionStorageRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const ExtensionRuntimeSelectionLive = Layer.mergeAll(
  ExtensionLifecycleRepositoryLive,
  ExtensionProjectOverridesRepositoryLive,
  FilesystemExtensionManagerLive,
  ExtensionBuildRunnerLive,
)
const ProviderServiceWithExtensionSelectionLive = ProviderServiceLive.pipe(
  Layer.provide(ExtensionRuntimeSelectionLive),
)
const PiProviderProbeWithExtensionSelectionLive = PiProviderProbeLive.pipe(
  Layer.provide(ExtensionRuntimeSelectionLive),
)

const AppLayer = Layer.mergeAll(
  NodeContext.layer,
  AppLogger.Live,
  AppDatabaseLive,
  SettingsService.Live,
  ExtensionRuntimeSelectionLive,
  ExtensionStorageRepositoryLive,
  SqliteSessionProjectionRepositoryLive,
  SqliteSessionRepositoryLive,
  FilesystemStandardsLive,
  PiAgentKernelLive,
  PiMcpConfigServiceLive,
  PiProviderAuthLive,
  PiProviderProbeWithExtensionSelectionLive,
  PiProviderOAuthLive,
  ProviderServiceWithExtensionSelectionLive,
  PiSessionTreePreferencesLive,
  SettingsWagglePresetsRepositoryLive,
)

function makeAppRuntime() {
  return ManagedRuntime.make(AppLayer)
}

let currentRuntime = makeAppRuntime()

installStoreEffectRunner()

export type AppServices =
  typeof AppLayer extends Layer.Layer<infer R, infer _E, infer _RIn> ? R : never
export type AppRuntimeError =
  typeof AppLayer extends Layer.Layer<infer _R, infer E, infer _RIn> ? E : never

function getAppRuntime() {
  return currentRuntime
}

function installStoreEffectRunner() {
  setStoreEffectRunner((effect) => getAppRuntime().runPromise(effect))
}

export async function initializeAppRuntime(): Promise<void> {
  await getAppRuntime().runPromise(Effect.void)
}

export async function disposeAppRuntime(): Promise<void> {
  await getAppRuntime().dispose()
}

export async function resetAppRuntimeForTests(): Promise<void> {
  await disposeAppRuntime()
  currentRuntime = makeAppRuntime()
  installStoreEffectRunner()
}

export function runAppEffect<A, E>(effect: EffectType<A, E, AppServices>): Promise<A> {
  return getAppRuntime().runPromise(effect)
}

export function runAppEffectExit<A, E>(
  effect: EffectType<A, E, AppServices>,
): Promise<ExitType<A, E | AppRuntimeError>> {
  return getAppRuntime().runPromiseExit(effect)
}
