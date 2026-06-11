import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { getExtensionGrantIds } from '../../extensions/runtime-eligibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleState,
  ExtensionPackageScope,
  ExtensionProjectOverrideKey,
  ExtensionProjectOverrideState,
} from '../../extensions/types'
import { ActiveProjectChangeService } from '../../ports/active-project-change-service'
import { DocsBundleService } from '../../ports/docs-bundle-service'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import type { AppLoggerService } from '../../services/logger-service'
import { AppLogger } from '../../services/logger-service'
import { SettingsService } from '../../services/settings-service'
import { makeSessionDetail } from './extension-capability-broker-session-test-utils'
import { makeBrokerSettingsLayer } from './extension-capability-broker-settings-test-utils'
import { makeExtensionStorageRepositoryLayer } from './extension-capability-broker-storage-repository-test-utils'

export const TRUSTED_MAIN_TEST_PROJECT_PATH = '/tmp/project'
const SDK_RANGE = '>=0.1.0 <0.2.0'

interface CapturedLog {
  readonly namespace: string
  readonly message: string
}

function scopesMatch(left: ExtensionPackageScope, right: ExtensionPackageScope) {
  if (left.kind !== right.kind) {
    return false
  }

  if (left.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return true
  }

  return (
    right.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND && left.projectPath === right.projectPath
  )
}

function projectOverrideMatches(
  state: ExtensionProjectOverrideState,
  key: ExtensionProjectOverrideKey,
) {
  return (
    state.extensionId === key.extensionId &&
    state.projectPath === key.projectPath &&
    scopesMatch(state.scope, key.scope)
  )
}

export function makeTrustedMainPackage(input: {
  readonly id: string
  readonly scope?: ExtensionPackageScope
  readonly capabilities?: NonNullable<DiscoveredExtensionPackage['manifest']>['capabilities']
}): DiscoveredExtensionPackage {
  const scope = input.scope ?? {
    kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
    projectPath: TRUSTED_MAIN_TEST_PROJECT_PATH,
  }
  const packagePath =
    scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
      ? `/tmp/user-data/extensions/${input.id}`
      : `${scope.projectPath}/.openwaggle/extensions/${input.id}`
  const manifest = {
    manifestVersion: 1,
    id: input.id,
    name: input.id,
    version: '1.0.0',
    sdk: { openwaggle: SDK_RANGE },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: ['dist/main.mjs'],
    ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
    trusted: {
      main: 'dist/main.mjs',
    },
  } satisfies NonNullable<DiscoveredExtensionPackage['manifest']>

  return {
    id: input.id,
    scope,
    packagePath,
    manifestPath: `${packagePath}/${OPENWAGGLE_EXTENSION.MANIFEST_FILE}`,
    manifest,
    buildPlan: null,
    contentHash: `${input.id}-hash`,
    sdkCompatibility: {
      hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
      requiredRange: SDK_RANGE,
      compatible: true,
    },
    diagnostics: [],
  }
}

export function makeTrustedMainLifecycle(
  extensionPackage: DiscoveredExtensionPackage,
  options: {
    readonly enabled?: boolean
    readonly trusted?: boolean
    readonly grantedCapabilities?: readonly string[]
  } = {},
): ExtensionLifecycleState {
  return {
    extensionId: extensionPackage.id,
    scope: extensionPackage.scope,
    enabled: options.enabled ?? true,
    trusted: options.trusted ?? true,
    grantedCapabilities: options.grantedCapabilities ?? getExtensionGrantIds(extensionPackage),
    contentHash: extensionPackage.contentHash,
    packageVersion: extensionPackage.manifest?.version ?? null,
    approvedBuildPlanHash: null,
    buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
    buildLog: null,
    reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
    lastReloadedAt: 3000,
    sdkRange: SDK_RANGE,
    sdkCompatible: true,
    diagnostics: [],
    installedAt: 1000,
    updatedAt: 2000,
  }
}

function makeLoggerLayer(capturedLogs: CapturedLog[]) {
  const logger: AppLoggerService = {
    debug: () => Effect.void,
    info: () => Effect.void,
    warn: (namespace, message) =>
      Effect.sync(() => {
        capturedLogs.push({ namespace, message })
      }),
    error: () => Effect.void,
  }
  return Layer.succeed(AppLogger, logger)
}

function makeDocsBundleLayer() {
  return Layer.succeed(DocsBundleService, {
    getBundlePath: () => Effect.succeed('/tmp/docs'),
    loadBundle: () =>
      Effect.succeed({
        bundlePath: '/tmp/docs',
        generatedAt: '2026-01-01T00:00:00.000Z',
        topics: [],
      }),
    listTopics: () => Effect.succeed([]),
    resolveTopic: () => Effect.succeed(null),
  })
}

function makeSessionLayers() {
  return Layer.mergeAll(
    Layer.succeed(SessionProjectionRepository, {
      get: () => Effect.succeed(makeSessionDetail(TRUSTED_MAIN_TEST_PROJECT_PATH)),
      getOptional: () => Effect.succeed(null),
      list: () => Effect.succeed([]),
      listDetails: () => Effect.succeed([]),
      create: ({ projectPath }) => Effect.succeed(makeSessionDetail(projectPath)),
      delete: () => Effect.void,
      archive: () => Effect.void,
      unarchive: () => Effect.void,
      listArchived: () => Effect.succeed([]),
      updateTitle: () => Effect.void,
    }),
    Layer.succeed(SessionRepository, {
      list: () => Effect.succeed([]),
      listArchivedBranches: () => Effect.succeed([]),
      getTree: () => Effect.succeed(null),
      getWorkspace: () => Effect.succeed(null),
      persistSnapshot: () => Effect.void,
      updateRuntime: () => Effect.void,
      renameBranch: () => Effect.void,
      archiveBranch: () => Effect.void,
      restoreBranch: () => Effect.void,
      updateTreeUiState: () => Effect.void,
      recordActiveRun: () => Effect.void,
      clearActiveRun: () => Effect.void,
      clearInterruptedRuns: () => Effect.void,
      listActiveRunsForRecovery: () => Effect.succeed([]),
      markActiveRunInterrupted: () => Effect.void,
    }),
  )
}

function makeSettingsLayer(input: {
  readonly projectPath: string | null
  readonly failure?: Error
}) {
  if (input.failure === undefined) {
    return makeBrokerSettingsLayer(input.projectPath)
  }

  const failure = input.failure
  return Layer.succeed(SettingsService, {
    get: () => Effect.die(failure),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  })
}

export function makeTrustedMainActivationHarness(input: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycles: readonly ExtensionLifecycleState[]
  readonly projectOverrides?: readonly ExtensionProjectOverrideState[]
  readonly settingsProjectPath?: string | null
  readonly settingsGetFailure?: Error
}) {
  let lifecycles = [...input.lifecycles]
  let projectOverrides = [...(input.projectOverrides ?? [])]
  const settingsProjectPath =
    input.settingsProjectPath === undefined
      ? TRUSTED_MAIN_TEST_PROJECT_PATH
      : input.settingsProjectPath
  const capturedLogs: CapturedLog[] = []
  const layer = Layer.mergeAll(
    Layer.succeed(ActiveProjectChangeService, {
      reconcileTrustedMainExtensions: () => Effect.void,
    }),
    makeLoggerLayer(capturedLogs),
    makeDocsBundleLayer(),
    makeExtensionStorageRepositoryLayer([]),
    makeSettingsLayer({ projectPath: settingsProjectPath, failure: input.settingsGetFailure }),
    makeSessionLayers(),
    Layer.succeed(ExtensionManagerService, {
      listPackages: () => Effect.succeed(input.packages),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: (key) =>
        Effect.succeed(
          lifecycles.find(
            (lifecycle) =>
              lifecycle.extensionId === key.extensionId && scopesMatch(lifecycle.scope, key.scope),
          ) ?? null,
        ),
      list: (scope) =>
        Effect.succeed(lifecycles.filter((lifecycle) => scopesMatch(lifecycle.scope, scope))),
      upsert: (state) =>
        Effect.sync(() => {
          lifecycles = [
            ...lifecycles.filter(
              (lifecycle) =>
                lifecycle.extensionId !== state.extensionId ||
                !scopesMatch(lifecycle.scope, state.scope),
            ),
            state,
          ]
        }),
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: (key) =>
        Effect.sync(
          () => projectOverrides.find((override) => projectOverrideMatches(override, key)) ?? null,
        ),
      upsert: (state) =>
        Effect.sync(() => {
          projectOverrides = [
            ...projectOverrides.filter((override) => !projectOverrideMatches(override, state)),
            state,
          ]
        }),
    }),
  )

  return {
    layer,
    getLifecycle: (extensionId: string) =>
      lifecycles.find((lifecycle) => lifecycle.extensionId === extensionId) ?? null,
    getProjectOverride: (key: ExtensionProjectOverrideKey) =>
      projectOverrides.find((override) => projectOverrideMatches(override, key)) ?? null,
    capturedLogs: () => capturedLogs.map((log) => log),
  }
}
