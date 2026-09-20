import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { SessionDetail, SessionTree } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { PINNED_SESSION_REPOSITORY_STUB } from '../../ports/__tests__/session-projection-pin-stub'
import { ActiveProjectChangeService } from '../../ports/active-project-change-service'
import { DocsBundleService } from '../../ports/docs-bundle-service'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import type { ExtensionStorageItem } from '../../ports/extension-storage-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import type { AppLoggerService } from '../../services/logger-service'
import { AppLogger } from '../../services/logger-service'
import type { CapturedLog } from './broker-log-test-utils'
import { makeSessionResourceRepositoryTestLayer } from './extension-capability-broker-resource-test-utils'
import { makeSessionDetail } from './extension-capability-broker-session-test-utils'
import { makeBrokerSettingsLayer } from './extension-capability-broker-settings-test-utils'
import { makeExtensionStorageRepositoryLayer } from './extension-capability-broker-storage-repository-test-utils'
import {
  type makeProjectOverride,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

const DOCS_BUNDLE_PATH = '/tmp/openwaggle-docs'
const DOCS_GENERATED_AT = '2026-01-01T00:00:00.000Z'

function scopesMatch(
  left: DiscoveredExtensionPackage['scope'],
  right: DiscoveredExtensionPackage['scope'],
) {
  if (left.kind !== right.kind) return false
  if (left.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) return true
  return (
    right.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND && left.projectPath === right.projectPath
  )
}

function isVisiblePackage(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string | null | undefined,
) {
  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND ||
    (projectPath !== null &&
      projectPath !== undefined &&
      extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
      extensionPackage.scope.projectPath === projectPath)
  )
}

function makeLoggerLayer(capturedLogs: CapturedLog[]) {
  const logger: AppLoggerService = {
    debug: () => Effect.void,
    info: (namespace, message, data) =>
      Effect.sync(() => {
        capturedLogs.push({
          namespace,
          message,
          ...(data !== undefined ? { data } : {}),
        })
      }),
    warn: () => Effect.void,
    error: () => Effect.void,
  }
  return Layer.succeed(AppLogger, logger)
}

export function makeBrokerLayer(input: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycles: readonly ExtensionLifecycleState[]
  readonly projectOverrides?: readonly ReturnType<typeof makeProjectOverride>[]
  readonly sessionDetail?: SessionDetail
  readonly sessionDetails?: readonly SessionDetail[]
  readonly sessionTree?: SessionTree
  readonly resources: SessionResource[]
  readonly resourceUpserts: UpsertSessionResourceInput[]
  readonly storageItems: ExtensionStorageItem[]
  readonly capturedLogs: CapturedLog[]
  readonly currentProjectPath: string | null
  readonly reconciledProjectPaths: string[]
  readonly reconcileFailure?: Error
}) {
  const projectOverrides = input.projectOverrides ?? []
  const sessionDetails = input.sessionDetails ?? (input.sessionDetail ? [input.sessionDetail] : [])

  return Layer.mergeAll(
    makeLoggerLayer(input.capturedLogs),
    makeExtensionStorageRepositoryLayer(input.storageItems),
    makeBrokerSettingsLayer(input.currentProjectPath),
    Layer.succeed(ActiveProjectChangeService, {
      reconcileTrustedMainExtensions: (projectPath) => {
        if (input.reconcileFailure !== undefined) return Effect.die(input.reconcileFailure)
        return Effect.sync(() => {
          input.reconciledProjectPaths.push(projectPath ?? '<none>')
        })
      },
    }),
    Layer.succeed(DocsBundleService, {
      getBundlePath: () => Effect.succeed(DOCS_BUNDLE_PATH),
      loadBundle: () =>
        Effect.succeed({
          bundlePath: DOCS_BUNDLE_PATH,
          generatedAt: DOCS_GENERATED_AT,
          topics: [],
        }),
      listTopics: () => Effect.succeed([]),
      resolveTopic: () => Effect.succeed(null),
    }),
    Layer.succeed(ExtensionManagerService, {
      listPackages: ({ projectPath }) =>
        Effect.succeed(
          input.packages.filter((extensionPackage) =>
            isVisiblePackage(extensionPackage, projectPath),
          ),
        ),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: (key) =>
        Effect.succeed(
          input.lifecycles.find(
            (lifecycle) =>
              lifecycle.extensionId === key.extensionId && scopesMatch(lifecycle.scope, key.scope),
          ) ?? null,
        ),
      list: (scope) =>
        Effect.succeed(input.lifecycles.filter((lifecycle) => scopesMatch(lifecycle.scope, scope))),
      upsert: () => Effect.void,
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: (key) =>
        Effect.succeed(
          projectOverrides.find(
            (projectOverride) =>
              projectOverride.extensionId === key.extensionId &&
              scopesMatch(projectOverride.scope, key.scope) &&
              projectOverride.projectPath === key.projectPath,
          ) ?? null,
        ),
      upsert: () => Effect.void,
    }),
    Layer.succeed(SessionProjectionRepository, {
      get: () => Effect.sync(() => makeSessionDetail(PROJECT_PATH)),
      getOptional: (id) =>
        Effect.succeed(sessionDetails.find((session) => session.id === id) ?? null),
      getHiveRelations: () => Effect.succeed({ current: null, parent: null, workers: [] }),
      list: () => Effect.succeed([]),
      listDetails: () => Effect.succeed([]),
      create: ({ projectPath }) => Effect.succeed(makeSessionDetail(projectPath)),
      getDeletionBlocker: () => Effect.succeed(null),
      delete: () => Effect.void,
      archive: () => Effect.void,
      unarchive: () => Effect.void,
      listArchived: () => Effect.succeed([]),
      updateTitle: () => Effect.void,
      setWorktreePlan: () => Effect.void,
      setAuthorizationMode: () => Effect.void,
      listTurnCheckpoints: () => Effect.succeed([]),
      getTurnDiff: () => Effect.succeed(null),
      setTurnCheckpointAnchor: () => Effect.void,
      ...PINNED_SESSION_REPOSITORY_STUB,
    }),
    Layer.succeed(SessionRepository, {
      list: () => Effect.succeed([]),
      listArchivedBranches: () => Effect.succeed([]),
      getTree: (sessionId) =>
        Effect.succeed(input.sessionTree?.session.id === sessionId ? input.sessionTree : null),
      listResourceProjectionPage: () =>
        Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
      getResourceProjectionNodes: () => Effect.succeed([]),
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
    makeSessionResourceRepositoryTestLayer(input.resources, input.resourceUpserts),
  )
}
