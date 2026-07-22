import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { ActiveProjectChangeService } from '../../ports/active-project-change-service'
import { DocsBundleService } from '../../ports/docs-bundle-service'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import type { AppLoggerService } from '../../services/logger-service'
import { AppLogger } from '../../services/logger-service'
import { makeSessionDetail } from './extension-capability-broker-session-test-utils'
import { makeBrokerSettingsLayer } from './extension-capability-broker-settings-test-utils'
import { makeExtensionStorageRepositoryLayer } from './extension-capability-broker-storage-repository-test-utils'

const PROJECT_PATH = '/tmp/project'

function makeLoggerLayer() {
  const logger: AppLoggerService = {
    debug: () => Effect.void,
    info: () => Effect.void,
    warn: () => Effect.void,
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
      get: () => Effect.succeed(makeSessionDetail(PROJECT_PATH)),
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

export const TrustedMainActivationDependenciesTestLayer = Layer.mergeAll(
  Layer.succeed(ActiveProjectChangeService, {
    reconcileTrustedMainExtensions: () => Effect.void,
  }),
  makeLoggerLayer(),
  makeDocsBundleLayer(),
  makeExtensionStorageRepositoryLayer([]),
  makeBrokerSettingsLayer(PROJECT_PATH),
  makeSessionLayers(),
)
