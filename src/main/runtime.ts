import * as NodeContext from '@effect/platform-node/NodeContext'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import type { Exit as ExitType } from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { AgentRequestedWaggleServiceLive } from './adapters/agent-requested-waggle-adapter'
import { LiveAgentRunInterruptionService } from './adapters/agent-run-interruption-service'
import { FilesystemDocsBundleLive } from './adapters/filesystem-docs-bundle-service'
import { FilesystemInlineVisualizationLive } from './adapters/filesystem-inline-visualization-service'
import { FilesystemSessionExportArtifactWriterLive } from './adapters/filesystem-session-export-artifact-writer'
import { FilesystemSessionExportResourceResolverLive } from './adapters/filesystem-session-export-resource-resolver'
import { FilesystemSessionResourceStoreLive } from './adapters/filesystem-session-resource-store'
import { FilesystemWorkspaceFileLive } from './adapters/filesystem-workspace-file-service'
import { LocalSessionCredentialVerifierLive } from './adapters/local-session-credential-verifier'
import { PiSessionTranscriptRepairLive } from './adapters/pi/agent-kernel/snapshot-entry-id-repair'
import { PiAgentSteeringServiceLive } from './adapters/pi/pi-agent-steering-adapter'
import { registerPiBundledOAuthFlows } from './adapters/pi/pi-bundled-oauth'
import { PiProviderAuthLive } from './adapters/pi/pi-provider-auth-service'
import { PiProviderOAuthLive } from './adapters/pi/pi-provider-oauth-service'
import { PiProviderProbeLive } from './adapters/pi/pi-provider-probe-adapter'
import { ProviderServiceLive } from './adapters/pi/pi-provider-service'
import { PiSessionOrchestrationUpdateDeliveryServiceLive } from './adapters/pi/pi-session-orchestration-update-delivery-service'
import { PiSessionReportDeliveryServiceLive } from './adapters/pi/pi-session-report-delivery-service'
import { PiSessionTreePreferencesLive } from './adapters/pi/pi-session-tree-preferences-service'
import { PiThinkingLevelDefaultLive } from './adapters/pi/pi-thinking-level-default-service'
import { SecureSessionResourceImageFetcherLive } from './adapters/secure-session-resource-image-fetcher'
import { LiveSessionControlAttachmentService } from './adapters/session-control-attachment-service'
import { SessionControlIdentityServiceLive } from './adapters/session-control-identity-service'
import { SessionControlRunExecutorLive } from './adapters/session-control-run-executor'
import { SessionLifecycleIdentityServiceLive } from './adapters/session-lifecycle-identity-service'
import { SessionLifecyclePreparationServiceLive } from './adapters/session-lifecycle-preparation-service'
import { SettingsWagglePresetsRepositoryLive } from './adapters/settings-waggle-presets-repository'
import { SharpSessionResourceImageValidatorLive } from './adapters/sharp-session-resource-image-validator'
import { SharpSessionResourceThumbnailerLive } from './adapters/sharp-session-resource-thumbnailer'
import { SqliteExtensionStorageRepositoryLive } from './adapters/sqlite-extension-storage-repository'
import { SqliteSessionOutputRetryRepositoryLive } from './adapters/sqlite-session-output-retry-repository'
import { SqliteSessionRepositoryLive as SqliteSessionRepositoryWithoutRepairLive } from './adapters/sqlite-session-repository'
import { SqliteSessionResourceCleanupRepositoryLive } from './adapters/sqlite-session-resource-cleanup-repository'
import { SqliteSessionResourceRepositoryLive } from './adapters/sqlite-session-resource-repository'
import { UsageStatisticsServicesLive } from './adapters/usage-statistics-recorder-live'
import { WorkspaceProjectAuthorizationLive } from './adapters/workspace-project-authorization'
import { ActiveProjectChangeServiceLive } from './application/active-project-change-service'
import { promptCacheWarming } from './application/prompt-cache-warming'
import { SessionWaitServiceLive } from './application/session-wait-service'
import { makeSourceControlSettingsAccess } from './application/source-control-settings-access'
import { startMcpHostServices } from './mcp-host-start'
import {
  closeHostMcpConnections,
  HostPiAgentKernelLive,
  McpServicesLive,
} from './mcp-runtime-layers'
import { OperationAdapterLive } from './operation-adapter-layer'
import {
  ActionKernelServicesLive,
  ActionServicesLive,
  SessionProjectionWithActionsLive as SqliteSessionProjectionRepositoryLive,
} from './runtime-action-services'
import { DesktopServicesLive } from './runtime-desktop-services'
import { ExtensionRuntimeSelectionLive } from './runtime-extension-selection'
import { HiveWorkerCleanupServicesLive } from './runtime-hive-cleanup-services'
import {
  type HostServiceOptions,
  startHostBackgroundServices,
  startHostServicesAfterListening,
  stopHostServicesAfterListening,
} from './runtime-host-services'
import { installPiRuntimeIntegration } from './runtime-pi-integration'
import { PiSessionContinuationServicesLive } from './runtime-pi-session-discovery-services'
import { SessionControlPersistenceLive } from './runtime-session-control-persistence'
import { SessionTitleServicesLive } from './runtime-session-title-services'
import { AppDatabaseLive } from './services/database-service'
import { AppLogger } from './services/logger-service'
import { SettingsService } from './services/settings-service'
import { configureSourceControlSettingsAccess } from './services/source-control/source-control-runtime'
import { setStoreEffectRunner } from './store/store-runtime'

const SqliteSessionRepositoryLive = SqliteSessionRepositoryWithoutRepairLive.pipe(
  Layer.provide(PiSessionTranscriptRepairLive),
)
const ExtensionStorageRepositoryLive = SqliteExtensionStorageRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const SessionResourceRepositoryLive = SqliteSessionResourceRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const SessionResourceCleanupRepositoryLive = SqliteSessionResourceCleanupRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const SessionOutputRetryRepositoryLive = SqliteSessionOutputRetryRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const ProviderServiceWithExtensionSelectionLive = ProviderServiceLive.pipe(
  Layer.provide(ExtensionRuntimeSelectionLive),
)
const PiProviderProbeWithExtensionSelectionLive = PiProviderProbeLive.pipe(
  Layer.provide(ExtensionRuntimeSelectionLive),
)
const PiAgentKernelWithExtensionSelectionLive = HostPiAgentKernelLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      ExtensionRuntimeSelectionLive,
      ActionKernelServicesLive,
      FilesystemInlineVisualizationLive,
      FilesystemDocsBundleLive,
      DesktopServicesLive,
      SettingsService.Live,
    ),
  ),
)
const ActiveProjectChangeDependenciesLive = Layer.mergeAll(
  AppLogger.Live,
  SettingsService.Live,
  FilesystemDocsBundleLive,
  ExtensionRuntimeSelectionLive,
  ExtensionStorageRepositoryLive,
  SessionResourceRepositoryLive,
  FilesystemSessionResourceStoreLive,
  SecureSessionResourceImageFetcherLive,
  SharpSessionResourceImageValidatorLive,
  SqliteSessionProjectionRepositoryLive,
  SqliteSessionRepositoryLive,
  PiThinkingLevelDefaultLive,
)
const ActiveProjectChangeWithDependenciesLive = ActiveProjectChangeServiceLive.pipe(
  Layer.provide(ActiveProjectChangeDependenciesLive),
)

const SessionExportResourceResolverWithDatabaseLive =
  FilesystemSessionExportResourceResolverLive.pipe(Layer.provide(AppDatabaseLive))
const SessionControlAttachmentWithDatabaseLive = LiveSessionControlAttachmentService.pipe(
  Layer.provide(AppDatabaseLive),
)
const SessionLifecyclePreparationWithDependenciesLive = SessionLifecyclePreparationServiceLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      AppDatabaseLive,
      SettingsService.Live,
      PiAgentKernelWithExtensionSelectionLive,
      PiThinkingLevelDefaultLive,
    ),
  ),
)
const SessionWaitWithDependenciesLive = SessionWaitServiceLive.pipe(
  Layer.provide(SessionControlPersistenceLive),
)
const SessionReportDeliveryWithDependenciesLive = PiSessionReportDeliveryServiceLive.pipe(
  Layer.provide(SessionControlPersistenceLive),
)
const SessionOrchestrationUpdateDeliveryWithDependenciesLive =
  PiSessionOrchestrationUpdateDeliveryServiceLive.pipe(Layer.provide(SessionControlPersistenceLive))
const AgentRequestedWaggleWithDependenciesLive = AgentRequestedWaggleServiceLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      ExtensionRuntimeSelectionLive,
      ProviderServiceWithExtensionSelectionLive,
      PiAgentKernelWithExtensionSelectionLive,
      SqliteSessionProjectionRepositoryLive,
      SqliteSessionRepositoryLive,
      SessionResourceRepositoryLive,
      FilesystemSessionResourceStoreLive,
      SharpSessionResourceImageValidatorLive,
      SettingsService.Live,
    ),
  ),
)
const SessionControlRunExecutorWithDependenciesLive = SessionControlRunExecutorLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      ExtensionRuntimeSelectionLive,
      ProviderServiceWithExtensionSelectionLive,
      PiAgentKernelWithExtensionSelectionLive,
      AgentRequestedWaggleWithDependenciesLive,
      SqliteSessionProjectionRepositoryLive,
      SqliteSessionRepositoryLive,
      SessionResourceRepositoryLive,
      FilesystemSessionResourceStoreLive,
      SharpSessionResourceImageValidatorLive,
      SettingsService.Live,
      SessionControlAttachmentWithDatabaseLive,
      AppDatabaseLive,
      SessionControlPersistenceLive,
      PiSessionContinuationServicesLive.pipe(Layer.provide(ExtensionRuntimeSelectionLive)),
    ),
  ),
)
const SessionControlServicesLive = Layer.mergeAll(
  SessionControlPersistenceLive,
  SessionControlIdentityServiceLive,
  SessionLifecycleIdentityServiceLive,
  SessionLifecyclePreparationWithDependenciesLive,
  SessionControlRunExecutorWithDependenciesLive,
  SessionControlAttachmentWithDatabaseLive,
  LiveAgentRunInterruptionService,
  PiAgentSteeringServiceLive,
  LocalSessionCredentialVerifierLive,
  SessionWaitWithDependenciesLive,
  SessionReportDeliveryWithDependenciesLive,
  SessionOrchestrationUpdateDeliveryWithDependenciesLive,
  FilesystemSessionExportArtifactWriterLive,
  SessionExportResourceResolverWithDatabaseLive,
  HiveWorkerCleanupServicesLive,
)

registerPiBundledOAuthFlows()

const AppLayer = Layer.mergeAll(
  ActionServicesLive,
  NodeContext.layer,
  AppLogger.Live,
  AppDatabaseLive,
  SettingsService.Live,
  ActiveProjectChangeWithDependenciesLive,
  FilesystemDocsBundleLive,
  ExtensionRuntimeSelectionLive,
  ExtensionStorageRepositoryLive,
  SessionResourceRepositoryLive,
  SessionResourceCleanupRepositoryLive,
  SessionOutputRetryRepositoryLive,
  FilesystemSessionResourceStoreLive,
  SecureSessionResourceImageFetcherLive,
  SharpSessionResourceImageValidatorLive,
  SharpSessionResourceThumbnailerLive,
  SqliteSessionProjectionRepositoryLive,
  SqliteSessionRepositoryLive,
  PiSessionContinuationServicesLive.pipe(Layer.provide(ExtensionRuntimeSelectionLive)),
  SessionTitleServicesLive.pipe(Layer.provide(ExtensionRuntimeSelectionLive)),
  PiAgentKernelWithExtensionSelectionLive,
  McpServicesLive,
  PiProviderAuthLive,
  PiProviderProbeWithExtensionSelectionLive,
  PiProviderOAuthLive,
  ProviderServiceWithExtensionSelectionLive,
  PiSessionTreePreferencesLive,
  PiThinkingLevelDefaultLive,
  SettingsWagglePresetsRepositoryLive,
  FilesystemWorkspaceFileLive,
  OperationAdapterLive,
  SessionControlServicesLive,
  WorkspaceProjectAuthorizationLive,
  FilesystemInlineVisualizationLive,
  DesktopServicesLive,
  UsageStatisticsServicesLive,
)

let currentRuntime = ManagedRuntime.make(AppLayer)
let stopHostOwnedServices: (() => Promise<void>) | null = null

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
  // Settings shared with Pi, and prompt cache warming, before anything loads Settings or runs.
  installPiRuntimeIntegration()
  await getAppRuntime().runPromise(
    Effect.gen(function* () {
      const settings = yield* SettingsService
      configureSourceControlSettingsAccess(makeSourceControlSettingsAccess(settings))
    }),
  )
}

export async function disposeAppRuntime(): Promise<void> {
  await stopHostServicesAfterListening()
  await stopSessionHostOwnedServices()
  // Stdio MCP servers must not outlive the Host.
  await closeHostMcpConnections()
  await getAppRuntime().dispose()
}

/** Once the Host serves clients; Host start does not wait for it. */
export const startSessionHostServicesAfterListening = startHostServicesAfterListening

export async function startSessionHostOwnedServices(options: HostServiceOptions<AppServices> = {}) {
  if (stopHostOwnedServices) return
  // Host-only: the desktop app's MCP channels are all Host-backed (ADR 0051).
  startMcpHostServices()
  promptCacheWarming().start()
  const started = Promise.withResolvers<void>()
  let didStart = false
  const fiber = getAppRuntime().runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* startHostBackgroundServices(options)
        yield* Effect.sync(() => {
          didStart = true
          started.resolve()
        })
        return yield* Effect.never
      }),
    ),
  )
  stopHostOwnedServices = async () => {
    stopHostOwnedServices = null
    await getAppRuntime().runPromise(Fiber.interrupt(fiber))
  }
  void getAppRuntime()
    .runPromise(Fiber.await(fiber))
    .then(() => {
      if (!didStart)
        started.reject(new Error('Session Host-owned services stopped during startup.'))
    })
  await started.promise
}

export async function stopSessionHostOwnedServices(): Promise<void> {
  const stop = stopHostOwnedServices
  if (stop) await stop()
  await promptCacheWarming().stop()
}

export async function resetAppRuntimeForTests(): Promise<void> {
  await disposeAppRuntime()
  currentRuntime = ManagedRuntime.make(AppLayer)
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
