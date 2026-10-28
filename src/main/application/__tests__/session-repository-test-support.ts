import * as Effect from 'effect/Effect'
import type { SessionRepositoryShape } from '../../ports/session-repository'

/** Empty catalog behavior for tests that exercise unrelated SessionRepository capabilities. */
export const emptySessionCatalogMethods = {
  listCatalogPage: () => Effect.succeed({ sessions: [] }),
  listProjectPage: () => Effect.succeed({ paths: [] }),
  hasActiveProjectPath: () => Effect.succeed(false),
  listByIds: () => Effect.succeed([]),
  listHiveCatalogPage: () => Effect.succeed({ context: [], workers: [] }),
  listHiveTreeCatalogPage: () => Effect.succeed({ root: null, members: [], needsYouCount: 0 }),
  listArchivedBranchCatalogPage: () => Effect.succeed({ sessions: [] }),
  queryArchivedItems: () =>
    Effect.succeed({
      items: [],
      total: 0,
      facets: {
        projects: [],
        archivedWithin: { any: 0, day: 0, week: 0, month: 0, older: 0 },
        kinds: { all: 0, session: 0, branch: 0 },
      },
    }),
  listArchivedItemRefs: () => Effect.succeed({ refs: [], total: 0 }),
  readArchivedItemStates: () => Effect.succeed(new Map()),
  setArchiveTimes: () => Effect.void,
  listResourceProjectionPage: () =>
    Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
  getResourceProjectionNodes: () => Effect.succeed([]),
  getNodeMutationRevision: () => Effect.succeed(null),
  searchTreeNodes: () => Effect.succeed({ nodeIds: [], incremental: false, cursor: null }),
} satisfies Pick<
  SessionRepositoryShape,
  | 'listCatalogPage'
  | 'listProjectPage'
  | 'hasActiveProjectPath'
  | 'listByIds'
  | 'listHiveCatalogPage'
  | 'listHiveTreeCatalogPage'
  | 'listArchivedBranchCatalogPage'
  | 'queryArchivedItems'
  | 'listArchivedItemRefs'
  | 'readArchivedItemStates'
  | 'setArchiveTimes'
  | 'listResourceProjectionPage'
  | 'getResourceProjectionNodes'
  | 'getNodeMutationRevision'
  | 'searchTreeNodes'
>
