import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { SessionDetail, SessionTree } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ActiveProjectChangeService } from '../../ports/active-project-change-service'
import { DocsBundleService } from '../../ports/docs-bundle-service'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import type { ExtensionStorageItem } from '../../ports/extension-storage-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import type { AppLoggerService } from '../../services/logger-service'
import { AppLogger } from '../../services/logger-service'
import { invokeExtensionCapability } from '../extension-capability-broker-service'
import { clearExtensionContributionRegistryCacheForTests } from '../extension-contribution-registry-cache'
import {
  BROKER_BRANCH_ID,
  BROKER_SESSION_ID,
  makeSessionDetail,
} from './extension-capability-broker-session-test-utils'
import { makeBrokerSettingsLayer } from './extension-capability-broker-settings-test-utils'
import { makeExtensionStorageRepositoryLayer } from './extension-capability-broker-storage-repository-test-utils'
import {
  makePackage,
  type makeProjectOverride,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

export const BROKER_EXTENSION_ID = 'broker-extension'
export const BROKER_CONTRIBUTION_ID = 'broker.run'
export const TIMESTAMP = 1234
export const SESSION_ID = BROKER_SESSION_ID
export const BRANCH_ID = BROKER_BRANCH_ID
const DOCS_BUNDLE_PATH = '/tmp/openwaggle-docs'
const DOCS_GENERATED_AT = '2026-01-01T00:00:00.000Z'

export {
  makeSessionDetail,
  makeSessionTree,
} from './extension-capability-broker-session-test-utils'

export interface CapturedLog {
  readonly namespace: string
  readonly message: string
  readonly data?: Readonly<Record<string, unknown>>
}

export function makeBrokerPackage() {
  return makePackage({
    id: BROKER_EXTENSION_ID,
    name: 'Broker Extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    capabilities: [
      {
        id: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        methods: [OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE],
        scopes: ['app', 'project', 'session', 'branch'],
      },
    ],
    contributions: {
      commands: [
        {
          id: BROKER_CONTRIBUTION_ID,
          title: 'Run Broker',
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        },
      ],
    },
  })
}

function scopesMatch(
  left: DiscoveredExtensionPackage['scope'],
  right: DiscoveredExtensionPackage['scope'],
) {
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

function makeBrokerLayer(input: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycles: readonly ExtensionLifecycleState[]
  readonly projectOverrides?: readonly ReturnType<typeof makeProjectOverride>[]
  readonly sessionDetail?: SessionDetail
  readonly sessionTree?: SessionTree
  readonly storageItems: ExtensionStorageItem[]
  readonly capturedLogs: CapturedLog[]
  readonly currentProjectPath: string | null
  readonly reconciledProjectPaths: string[]
  readonly reconcileFailure?: Error
}) {
  const projectOverrides = input.projectOverrides ?? []

  return Layer.mergeAll(
    makeLoggerLayer(input.capturedLogs),
    makeExtensionStorageRepositoryLayer(input.storageItems),
    makeBrokerSettingsLayer(input.currentProjectPath),
    Layer.succeed(ActiveProjectChangeService, {
      reconcileTrustedMainExtensions: (projectPath) => {
        if (input.reconcileFailure !== undefined) {
          return Effect.die(input.reconcileFailure)
        }

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
        Effect.succeed(
          input.sessionDetail && input.sessionDetail.id === id ? input.sessionDetail : null,
        ),
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
      getTree: (sessionId) =>
        Effect.succeed(
          input.sessionTree && input.sessionTree.session.id === sessionId
            ? input.sessionTree
            : null,
        ),
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

export function makeProjectInvocation(
  input: {
    readonly capability?: string
    readonly method?: string
    readonly contributionId?: string
    readonly payload?: unknown
    readonly scope?: ExtensionInvokeInput['scope']
  } = {},
): ExtensionInvokeInput {
  return {
    extensionId: BROKER_EXTENSION_ID,
    contributionId: input.contributionId ?? BROKER_CONTRIBUTION_ID,
    capability: input.capability ?? OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
    method: input.method ?? OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
    scope: input.scope ?? { kind: 'project', projectPath: PROJECT_PATH },
    ...(input.payload !== undefined ? { payload: input.payload } : { payload: {} }),
  }
}

export async function runBroker(input: {
  readonly invocation: ExtensionInvokeInput
  readonly packages?: readonly DiscoveredExtensionPackage[]
  readonly lifecycles?: readonly ExtensionLifecycleState[]
  readonly projectOverrides?: readonly ReturnType<typeof makeProjectOverride>[]
  readonly sessionDetail?: SessionDetail
  readonly sessionTree?: SessionTree
  readonly storageItems?: readonly ExtensionStorageItem[]
  readonly capturedLogs?: CapturedLog[]
  readonly currentProjectPath?: string | null
  readonly reconciledProjectPaths?: string[]
  readonly reconcileFailure?: Error
}) {
  const harness = makeBrokerHarness(input)
  return harness.run(input.invocation)
}

export function makeBrokerHarness(input: {
  readonly packages?: readonly DiscoveredExtensionPackage[]
  readonly lifecycles?: readonly ExtensionLifecycleState[]
  readonly projectOverrides?: readonly ReturnType<typeof makeProjectOverride>[]
  readonly sessionDetail?: SessionDetail
  readonly sessionTree?: SessionTree
  readonly storageItems?: readonly ExtensionStorageItem[]
  readonly capturedLogs?: CapturedLog[]
  readonly currentProjectPath?: string | null
  readonly reconciledProjectPaths?: string[]
  readonly reconcileFailure?: Error
}) {
  clearExtensionContributionRegistryCacheForTests()
  const capturedLogs = input.capturedLogs ?? []
  const reconciledProjectPaths = input.reconciledProjectPaths ?? []
  const storageItems = [...(input.storageItems ?? [])]
  const layer = makeBrokerLayer({
    packages: input.packages ?? [],
    lifecycles: input.lifecycles ?? [],
    projectOverrides: input.projectOverrides,
    sessionDetail: input.sessionDetail,
    sessionTree: input.sessionTree,
    storageItems,
    capturedLogs,
    currentProjectPath: input.currentProjectPath ?? PROJECT_PATH,
    reconciledProjectPaths,
    ...(input.reconcileFailure !== undefined ? { reconcileFailure: input.reconcileFailure } : {}),
  })

  return {
    run: (invocation: ExtensionInvokeInput) =>
      Effect.runPromise(
        invokeExtensionCapability(invocation, { now: () => TIMESTAMP }).pipe(Effect.provide(layer)),
      ),
    storageItems: () => storageItems.map((item) => item),
    reconciledProjectPaths: () => reconciledProjectPaths.map((projectPath) => projectPath),
  }
}
