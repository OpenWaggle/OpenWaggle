import * as NodeContext from '@effect/platform-node/NodeContext'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import type { Exit as ExitType } from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { ProviderServiceLive } from './adapters/provider-service-live'
import { SqliteConversationRepositoryLive } from './adapters/sqlite-conversation-repository'
import { SqliteTeamsRepositoryLive } from './adapters/sqlite-teams-repository'
import { FilesystemStandardsLive } from './adapters/standards-adapter'
import { TanStackChatLive } from './adapters/tanstack-chat-adapter'
import { AppDatabaseLive } from './services/database-service'
import { AppLogger } from './services/logger-service'
import { ProviderRegistryService } from './services/provider-registry-service'
import { SettingsService } from './services/settings-service'

const AppLayer = Layer.mergeAll(
  NodeContext.layer,
  AppLogger.Live,
  ProviderRegistryService.Live,
  AppDatabaseLive,
  SettingsService.Live,
  SqliteConversationRepositoryLive,
  FilesystemStandardsLive,
  TanStackChatLive,
  ProviderServiceLive,
  SqliteTeamsRepositoryLive,
)

function makeAppRuntime() {
  return ManagedRuntime.make(AppLayer)
}

let currentRuntime = makeAppRuntime()

export type AppServices =
  typeof AppLayer extends Layer.Layer<infer R, infer _E, infer _RIn> ? R : never
export type AppRuntimeError =
  typeof AppLayer extends Layer.Layer<infer _R, infer E, infer _RIn> ? E : never

function getAppRuntime() {
  return currentRuntime
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
}

export function runAppEffect<A, E>(effect: EffectType<A, E, AppServices>): Promise<A> {
  return getAppRuntime().runPromise(effect)
}

export function runAppEffectExit<A, E>(
  effect: EffectType<A, E, AppServices>,
): Promise<ExitType<A, E | AppRuntimeError>> {
  return getAppRuntime().runPromiseExit(effect)
}
