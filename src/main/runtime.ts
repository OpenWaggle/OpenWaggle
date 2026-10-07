import * as NodeContext from '@effect/platform-node/NodeContext'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import type { Exit as ExitType } from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { AgentRequestedWaggleServiceLive } from './adapters/agent-requested-waggle-adapter'
import { LiveAgentRunInterruptionService } from './adapters/agent-run-interruption-service'
import { ExtensionBuildRunnerLive } from './adapters/extension-build-runner'
import { FilesystemDocsBundleLive } from './adapters/filesystem-docs-bundle-service'
import { FilesystemExtensionManagerLive } from './adapters/filesystem-extension-manager-service'
import { FilesystemExtensionPackageRepositoryLive } from './adapters/filesystem-extension-package-repository'
import { FilesystemInlineVisualizationLive } from './adapters/filesystem-inline-visualization-service'
import { FilesystemSessionExportArtifactWriterLive } from './adapters/filesystem-session-export-artifact-writer'
import { FilesystemSessionExportResourceResolverLive } from './adapters/filesystem-session-export-resource-resolver'
import { FilesystemSessionResourceStoreLive } from './adapters/filesystem-session-resource-store'
import { FilesystemWorkspaceFileLive } from './adapters/filesystem-workspace-file-service'
import { LocalSessionCredentialVerifierLive } from './adapters/local-session-credential-verifier'
import { EncryptedMcpSecretVaultServiceLive } from './adapters/mcp/encrypted-mcp-secret-vault-service'
import { FilesystemMcpImportServiceLive } from './adapters/mcp/filesystem-mcp-import-service'
import { mcpSessionConnectionPool } from './adapters/mcp/pool/mcp-connection-pool-instance'
import { McpRegistryServiceLive } from './adapters/mcp/registry/mcp-registry-service'
import { idleCacheWarming } from './adapters/pi/agent-kernel/pi-idle-cache-warming'
import { forgetMcpAppTools } from './adapters/pi/mcp/mcp-app-registry'
import { OpenWaggleMcpConfigurationServiceLive } from './adapters/pi/mcp/openwaggle-mcp-configuration'
import { PiMcpAppRuntimeServiceLive } from './adapters/pi/mcp/pi-mcp-app-runtime-service'
import { PiMcpServerRuntimeServiceLive } from './adapters/pi/mcp/pi-mcp-server-runtime-service'
import { PiAgentKernelLive } from './adapters/pi/pi-agent-kernel-adapter'
import { PiAgentSteeringServiceLive } from './adapters/pi/pi-agent-steering-adapter'
import { registerPiBundledOAuthFlows } from './adapters/pi/pi-bundled-oauth'
import { PiProviderAuthLive } from './adapters/pi/pi-provider-auth-service'
import { PiProviderOAuthLive } from './adapters/pi/pi-provider-oauth-service'
import { PiProviderProbeLive } from './adapters/pi/pi-provider-probe-adapter'
import { ProviderServiceLive } from './adapters/pi/pi-provider-service'
import { PiSessionFilesLive } from './adapters/pi/pi-session-files'
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
import { SqliteExtensionLifecycleRepositoryLive } from './adapters/sqlite-extension-lifecycle-repository'
import { SqliteExtensionProjectOverridesRepositoryLive } from './adapters/sqlite-extension-project-overrides-repository'
import { SqliteExtensionStorageRepositoryLive } from './adapters/sqlite-extension-storage-repository'
import { SqlitePiSessionDiscoveryRepositoryLive } from './adapters/sqlite-pi-session-discovery-repository'
import { SqliteSessionOutputRetryRepositoryLive } from './adapters/sqlite-session-output-retry-repository'
import { SqliteSessionRepositoryLive } from './adapters/sqlite-session-repository'
import { SqliteSessionResourceCleanupRepositoryLive } from './adapters/sqlite-session-resource-cleanup-repository'
import { SqliteSessionResourceRepositoryLive } from './adapters/sqlite-session-resource-repository'
import { FilesystemStandardsLive } from './adapters/standards-adapter'
import { UsageStatisticsServicesLive } from './adapters/usage-statistics-recorder-live'
import { WorkspaceProjectAuthorizationLive } from './adapters/workspace-project-authorization'
import { ActiveProjectChangeServiceLive } from './application/active-project-change-service'
import { onSessionRemoved } from './application/session-removal-hooks'
import { SessionWaitServiceLive } from './application/session-wait-service'
import { OperationAdapterLive } from './operation-adapter-layer'
import {
  ActionKernelServicesLive,
  ActionServicesLive,
  SessionProjectionWithActionsLive as SqliteSessionProjectionRepositoryLive,
} from './runtime-action-services'
import { DesktopServicesLive } from './runtime-desktop-services'
import { HiveWorkerCleanupServicesLive } from './runtime-hive-cleanup-services'
import { startHostBackgroundServices } from './runtime-host-services'
import { SessionControlPersistenceLive } from './runtime-session-control-persistence'
import { SessionTitleServicesLive } from './runtime-session-title-services'
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
const SessionResourceRepositoryLive = SqliteSessionResourceRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const SessionResourceCleanupRepositoryLive = SqliteSessionResourceCleanupRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const SessionOutputRetryRepositoryLive = SqliteSessionOutputRetryRepositoryLive.pipe(
  Layer.provide(AppDatabaseLive),
)
const ExtensionRuntimeSelectionLive = Layer.mergeAll(
  ExtensionLifecycleRepositoryLive,
  ExtensionProjectOverridesRepositoryLive,
  FilesystemExtensionManagerLive,
  FilesystemExtensionPackageRepositoryLive,
  ExtensionBuildRunnerLive,
)
const ProviderServiceWithExtensionSelectionLive = ProviderServiceLive.pipe(
  Layer.provide(ExtensionRuntimeSelectionLive),
)
const PiProviderProbeWithExtensionSelectionLive = PiProviderProbeLive.pipe(
  Layer.provide(ExtensionRuntimeSelectionLive),
)
const PiAgentKernelWithExtensionSelectionLive = PiAgentKernelLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      ExtensionRuntimeSelectionLive,
      ActionKernelServicesLive,
      FilesystemInlineVisualizationLive,
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
  SqlitePiSessionDiscoveryRepositoryLive,
  PiSessionFilesLive,
  SessionTitleServicesLive,
  FilesystemStandardsLive,
  PiAgentKernelWithExtensionSelectionLive,
  EncryptedMcpSecretVaultServiceLive,
  OpenWaggleMcpConfigurationServiceLive,
  FilesystemMcpImportServiceLive,
  McpRegistryServiceLive,
  PiMcpServerRuntimeServiceLive,
  PiMcpAppRuntimeServiceLive,
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

let sessionRemovalHooksInstalled = false

export async function initializeAppRuntime(): Promise<void> {
  // Archiving or deleting a Session, including Hive cleanup of a Worker, closes its MCP servers
  // and ends its prompt cache warming.
  if (!sessionRemovalHooksInstalled) {
    sessionRemovalHooksInstalled = true
    onSessionRemoved((sessionId) => {
      forgetMcpAppTools(sessionId)
      // Hooks run before the Pi file is archived or deleted, so no warming session writes to it.
      idleCacheWarming.close(sessionId)
      return mcpSessionConnectionPool.closeSession(sessionId)
    })
  }
  await getAppRuntime().runPromise(Effect.void)
}

export async function disposeAppRuntime(): Promise<void> {
  await stopSessionHostOwnedServices()
  // Stdio MCP servers must not outlive the Host.
  await mcpSessionConnectionPool.closeAll()
  await getAppRuntime().dispose()
}

export async function startSessionHostOwnedServices(): Promise<void> {
  if (stopHostOwnedServices) return
  const started = Promise.withResolvers<void>()
  let didStart = false
  const fiber = getAppRuntime().runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* startHostBackgroundServices
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
  await idleCacheWarming.releaseAll()
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
