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
import { FilesystemSessionExportArtifactWriterLive } from './adapters/filesystem-session-export-artifact-writer'
import { FilesystemSessionExportResourceResolverLive } from './adapters/filesystem-session-export-resource-resolver'
import { FilesystemWorkspaceFileLive } from './adapters/filesystem-workspace-file-service'
import { GitSessionWorkspaceHandoffServiceLive } from './adapters/git-session-workspace-handoff-service'
import { LocalSessionCredentialVerifierLive } from './adapters/local-session-credential-verifier'
import { EncryptedMcpSecretVaultServiceLive } from './adapters/mcp/encrypted-mcp-secret-vault-service'
import { FilesystemMcpConfigServiceLive } from './adapters/mcp/filesystem-mcp-config-service'
import { FirstPartyMcpRuntimeServiceLive } from './adapters/mcp/first-party-mcp-runtime-service'
import { McpTurnStateServiceLive } from './adapters/mcp/mcp-turn-state-service'
import { PiAgentKernelLive } from './adapters/pi/pi-agent-kernel-adapter'
import { PiAgentSteeringServiceLive } from './adapters/pi/pi-agent-steering-adapter'
import { registerPiBundledOAuthFlows } from './adapters/pi/pi-bundled-oauth'
import { PiProviderAuthLive } from './adapters/pi/pi-provider-auth-service'
import { PiProviderOAuthLive } from './adapters/pi/pi-provider-oauth-service'
import { PiProviderProbeLive } from './adapters/pi/pi-provider-probe-adapter'
import { ProviderServiceLive } from './adapters/pi/pi-provider-service'
import { PiSessionOrchestrationUpdateDeliveryServiceLive } from './adapters/pi/pi-session-orchestration-update-delivery-service'
import { PiSessionReportDeliveryServiceLive } from './adapters/pi/pi-session-report-delivery-service'
import { PiSessionTreePreferencesLive } from './adapters/pi/pi-session-tree-preferences-service'
import { LiveSessionControlAttachmentService } from './adapters/session-control-attachment-service'
import { SessionControlIdentityServiceLive } from './adapters/session-control-identity-service'
import { SessionControlRunExecutorLive } from './adapters/session-control-run-executor'
import { SessionLifecycleIdentityServiceLive } from './adapters/session-lifecycle-identity-service'
import { SessionLifecyclePreparationServiceLive } from './adapters/session-lifecycle-preparation-service'
import { runSessionSemanticDiscoveryBackground } from './adapters/session-semantic-discovery-background'
import { SettingsWagglePresetsRepositoryLive } from './adapters/settings-waggle-presets-repository'
import { SqliteExtensionLifecycleRepositoryLive } from './adapters/sqlite-extension-lifecycle-repository'
import { SqliteExtensionProjectOverridesRepositoryLive } from './adapters/sqlite-extension-project-overrides-repository'
import { SqliteExtensionStorageRepositoryLive } from './adapters/sqlite-extension-storage-repository'
import { SqliteLocalSessionProfileRepositoryLive } from './adapters/sqlite-local-session-profile-repository'
import { SqliteSessionAuthorizationTargetRepositoryLive } from './adapters/sqlite-session-authorization-target-repository'
import { SqliteSessionControlOperationJournalLive } from './adapters/sqlite-session-control-operation-journal'
import { SqliteSessionControlRepositoryLive } from './adapters/sqlite-session-control-repository'
import { SqliteSessionControlRunLifecycleRepositoryLive } from './adapters/sqlite-session-control-run-lifecycle-repository'
import { SqliteSessionDelegationRepositoryLive } from './adapters/sqlite-session-delegation-repository'
import { SqliteSessionDescendantRunRepositoryLive } from './adapters/sqlite-session-descendant-run-repository'
import { SqliteSessionExportOperationRepositoryLive } from './adapters/sqlite-session-export-operation-repository'
import { SqliteSessionHostRecoveryRepositoryLive } from './adapters/sqlite-session-host-recovery-repository'
import { SqliteSessionLifecycleRepositoryLive } from './adapters/sqlite-session-lifecycle-repository'
import { SqliteSessionOrchestrationUpdateRepositoryLive } from './adapters/sqlite-session-orchestration-update-repository'
import { SqliteSessionOrganizationRepositoryLive } from './adapters/sqlite-session-organization-repository'
import { SqliteSessionProjectionRepositoryLive } from './adapters/sqlite-session-projection-repository'
import { SqliteSessionQueryRepositoryLive } from './adapters/sqlite-session-query-repository'
import { SqliteSessionReportRepositoryLive } from './adapters/sqlite-session-report-repository'
import { SqliteSessionRepositoryLive } from './adapters/sqlite-session-repository'
import { SqliteSessionWorkspaceResourceRepositoryLive } from './adapters/sqlite-session-workspace-resource-repository'
import { FilesystemStandardsLive } from './adapters/standards-adapter'
import { ActiveProjectChangeServiceLive } from './application/active-project-change-service'
import { activateTrustedMainExtensionsForActiveProjectSafely } from './application/extension-trusted-main-activation-service'
import { SessionWaitServiceLive } from './application/session-wait-service'
import { AppDatabaseLive } from './services/database-service'
import { AppLogger } from './services/logger-service'
import { SettingsService } from './services/settings-service'
import { installAppSessionToolGateway } from './session-host/session-tool-gateway-installer'
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
  FilesystemExtensionPackageRepositoryLive,
  ExtensionBuildRunnerLive,
)
const ProviderServiceWithExtensionSelectionLive = ProviderServiceLive.pipe(
  Layer.provide(ExtensionRuntimeSelectionLive),
)
const PiProviderProbeWithExtensionSelectionLive = PiProviderProbeLive.pipe(
  Layer.provide(ExtensionRuntimeSelectionLive),
)
const McpServicesLive = Layer.mergeAll(
  FilesystemMcpConfigServiceLive,
  EncryptedMcpSecretVaultServiceLive,
  FirstPartyMcpRuntimeServiceLive.pipe(Layer.provide(EncryptedMcpSecretVaultServiceLive)),
).pipe(Layer.provide(McpTurnStateServiceLive))
const PiAgentKernelWithExtensionSelectionLive = PiAgentKernelLive.pipe(
  Layer.provide(Layer.mergeAll(ExtensionRuntimeSelectionLive, McpServicesLive)),
)
const ActiveProjectChangeDependenciesLive = Layer.mergeAll(
  AppLogger.Live,
  SettingsService.Live,
  FilesystemDocsBundleLive,
  ExtensionRuntimeSelectionLive,
  ExtensionStorageRepositoryLive,
  SqliteSessionProjectionRepositoryLive,
  SqliteSessionRepositoryLive,
)
const ActiveProjectChangeWithDependenciesLive = ActiveProjectChangeServiceLive.pipe(
  Layer.provide(ActiveProjectChangeDependenciesLive),
)

const SessionControlPersistenceLive = Layer.mergeAll(
  GitSessionWorkspaceHandoffServiceLive,
  SqliteLocalSessionProfileRepositoryLive,
  SqliteSessionAuthorizationTargetRepositoryLive,
  SqliteSessionControlOperationJournalLive,
  SqliteSessionControlRepositoryLive,
  SqliteSessionControlRunLifecycleRepositoryLive,
  SqliteSessionHostRecoveryRepositoryLive,
  SqliteSessionLifecycleRepositoryLive,
  SqliteSessionQueryRepositoryLive,
  SqliteSessionReportRepositoryLive,
  SqliteSessionOrchestrationUpdateRepositoryLive,
  SqliteSessionOrganizationRepositoryLive,
  SqliteSessionDelegationRepositoryLive,
  SqliteSessionDescendantRunRepositoryLive,
  SqliteSessionExportOperationRepositoryLive,
  SqliteSessionWorkspaceResourceRepositoryLive,
).pipe(Layer.provide(AppDatabaseLive))
const SessionExportResourceResolverWithDatabaseLive =
  FilesystemSessionExportResourceResolverLive.pipe(Layer.provide(AppDatabaseLive))
const SessionControlAttachmentWithDatabaseLive = LiveSessionControlAttachmentService.pipe(
  Layer.provide(AppDatabaseLive),
)
const SessionLifecyclePreparationWithDependenciesLive = SessionLifecyclePreparationServiceLive.pipe(
  Layer.provide(
    Layer.mergeAll(AppDatabaseLive, SettingsService.Live, PiAgentKernelWithExtensionSelectionLive),
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
)
registerPiBundledOAuthFlows()

const AppLayer = Layer.mergeAll(
  NodeContext.layer,
  AppLogger.Live,
  AppDatabaseLive,
  SettingsService.Live,
  ActiveProjectChangeWithDependenciesLive,
  FilesystemDocsBundleLive,
  ExtensionRuntimeSelectionLive,
  ExtensionStorageRepositoryLive,
  SqliteSessionProjectionRepositoryLive,
  SqliteSessionRepositoryLive,
  FilesystemStandardsLive,
  PiAgentKernelWithExtensionSelectionLive,
  McpServicesLive,
  PiProviderAuthLive,
  PiProviderProbeWithExtensionSelectionLive,
  PiProviderOAuthLive,
  ProviderServiceWithExtensionSelectionLive,
  PiSessionTreePreferencesLive,
  SettingsWagglePresetsRepositoryLive,
  FilesystemWorkspaceFileLive,
  SessionControlServicesLive,
)

function makeAppRuntime() {
  return ManagedRuntime.make(AppLayer)
}

let currentRuntime = makeAppRuntime()
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
  await getAppRuntime().runPromise(Effect.void)
}

export async function disposeAppRuntime(): Promise<void> {
  await stopSessionHostOwnedServices()
  await getAppRuntime().dispose()
}

export async function startSessionHostOwnedServices(): Promise<void> {
  if (stopHostOwnedServices) return
  let markStarted: () => void = () => undefined
  let failStarted: (error: Error) => void = () => undefined
  let didStart = false
  const started = new Promise<void>((resolve, reject) => {
    markStarted = resolve
    failStarted = reject
  })
  const fiber = getAppRuntime().runFork(
    Effect.scoped(
      Effect.gen(function* () {
        yield* installAppSessionToolGateway
        yield* runSessionSemanticDiscoveryBackground
        yield* activateTrustedMainExtensionsForActiveProjectSafely()
        yield* Effect.sync(() => {
          didStart = true
          markStarted()
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
      if (!didStart) failStarted(new Error('Session Host-owned services stopped during startup.'))
    })
  await started
}

export async function stopSessionHostOwnedServices(): Promise<void> {
  const stop = stopHostOwnedServices
  if (stop) await stop()
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
