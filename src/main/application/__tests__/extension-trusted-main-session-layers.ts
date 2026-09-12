import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { PINNED_SESSION_REPOSITORY_STUB } from '../../ports/__tests__/session-projection-pin-stub'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { makeSessionDetail } from './extension-capability-broker-session-test-utils'

export function makeTrustedMainSessionLayers(projectPath: string) {
  return Layer.mergeAll(
    Layer.succeed(SessionProjectionRepository, {
      get: () => Effect.succeed(makeSessionDetail(projectPath)),
      getOptional: () => Effect.succeed(null),
      getHiveRelations: () => Effect.succeed({ current: null, parent: null, workers: [] }),
      list: () => Effect.succeed([]),
      listDetails: () => Effect.succeed([]),
      create: ({ projectPath: createdProjectPath }) =>
        Effect.succeed(makeSessionDetail(createdProjectPath)),
      hasDirectWorkers: () => Effect.succeed(false),
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
      getTree: () => Effect.succeed(null),
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
    Layer.succeed(SessionResourceRepository, {
      upsert: () => Effect.dieMessage('resource upsert is not configured for this test'),
      list: () => Effect.succeed([]),
      listPage: () =>
        Effect.succeed({ resources: [], total: 0, nextCursor: null, orderRevision: 'none' }),
      findById: () => Effect.succeed(null),
      findByOccurrence: () => Effect.succeed(null),
      findByLocator: () => Effect.succeed(null),
      locateImage: () => Effect.succeed(null),
      findByCanonicalKey: () => Effect.succeed(null),
      rekey: () => Effect.dieMessage('resource rekey is not configured for this test'),
      hasOccurrence: () => Effect.succeed(false),
      hasOccurrences: () => Effect.succeed(new Set()),
      findByOccurrences: () => Effect.succeed([]),
      listByNodeIds: () => Effect.succeed([]),
      listByNodeIdsPage: () =>
        Effect.succeed({ resources: [], total: 0, nextCursor: null, orderRevision: 'none' }),
      listManagedNodeIds: () => Effect.succeed([]),
      getContentLocation: () => Effect.succeed(null),
      getBackfillCursor: () => Effect.succeed(-1),
      advanceBackfillCursor: () => Effect.void,
    }),
  )
}
