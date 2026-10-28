/**
 * The desktop window's composition root (A-F5, ADR 0001): only the ports the GUI process uses
 * itself. The GUI is a Session Host client (ADR 0030); everything that needs Pi, MCP, the agent
 * kernel, SQLite or a model runtime runs in the Host and is reached through the Host UI contract.
 * The Host's composition root is `runtime.ts`, which this process never loads.
 */
import * as NodeContext from '@effect/platform-node/NodeContext'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import type { Exit as ExitType } from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { ElectronBrowserPreviewAutomationServiceLive } from './adapters/electron-browser-preview-automation-service'
import { FilesystemDocsBundleLive } from './adapters/filesystem-docs-bundle-service'
import { FilesystemInlineVisualizationLive } from './adapters/filesystem-inline-visualization-service'
import { FilesystemWorkspaceFileLive } from './adapters/filesystem-workspace-file-service'
import { GuiUsageStatisticsRecorderLive } from './adapters/gui-usage-statistics-recorder'
import { NodePtyTerminalServiceLive } from './adapters/node-pty-terminal-service'
import {
  LazyPiProviderAuthLive,
  LazyPiProviderOAuthLive,
  LazyPiSessionTreePreferencesLive,
} from './adapters/pi/gui-lazy-pi-services'
import { SettingsWagglePresetsRepositoryLive } from './adapters/settings-waggle-presets-repository'
import { WorkspaceProjectAuthorizationLive } from './adapters/workspace-project-authorization'
import { makeSourceControlSettingsAccess } from './application/source-control-settings-access'
import { AppLogger } from './services/logger-service'
import { SettingsService } from './services/settings-service'
import { configureSourceControlSettingsAccess } from './services/source-control/source-control-runtime'

const GuiLayer = Layer.mergeAll(
  NodeContext.layer,
  AppLogger.Live,
  SettingsService.Live,
  NodePtyTerminalServiceLive,
  ElectronBrowserPreviewAutomationServiceLive.pipe(Layer.provide(SettingsService.Live)),
  FilesystemWorkspaceFileLive,
  WorkspaceProjectAuthorizationLive,
  GuiUsageStatisticsRecorderLive,
  FilesystemDocsBundleLive,
  FilesystemInlineVisualizationLive,
  SettingsWagglePresetsRepositoryLive,
  LazyPiProviderOAuthLive,
  LazyPiProviderAuthLive,
  LazyPiSessionTreePreferencesLive,
)

export type GuiServices =
  typeof GuiLayer extends Layer.Layer<infer R, infer _E, infer _RIn> ? R : never
export type GuiRuntimeError =
  typeof GuiLayer extends Layer.Layer<infer _R, infer E, infer _RIn> ? E : never

let currentRuntime = ManagedRuntime.make(GuiLayer)

/** Source control reads and patches its Settings through the Session Host from the window. */
export async function initializeGuiRuntime(): Promise<void> {
  await currentRuntime.runPromise(
    Effect.gen(function* () {
      const settings = yield* SettingsService
      configureSourceControlSettingsAccess(makeSourceControlSettingsAccess(settings))
    }),
  )
}

export function runGuiEffect<A, E>(effect: EffectType<A, E, GuiServices>): Promise<A> {
  return currentRuntime.runPromise(effect)
}

export function runGuiEffectExit<A, E>(
  effect: EffectType<A, E, GuiServices>,
): Promise<ExitType<A, E | GuiRuntimeError>> {
  return currentRuntime.runPromiseExit(effect)
}

export async function disposeGuiRuntime(): Promise<void> {
  await currentRuntime.dispose()
}

export async function resetGuiRuntimeForTests(): Promise<void> {
  await currentRuntime.dispose()
  currentRuntime = ManagedRuntime.make(GuiLayer)
}
