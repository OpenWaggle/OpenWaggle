import * as Effect from 'effect/Effect'
import type { SessionRepositoryShape } from '../../ports/session-repository'

/** Empty catalog behavior for tests that exercise unrelated SessionRepository capabilities. */
export const emptySessionCatalogMethods = {
  listCatalogPage: () => Effect.succeed({ sessions: [] }),
  listProjectPage: () => Effect.succeed({ paths: [] }),
  hasActiveProjectPath: () => Effect.succeed(false),
  listByIds: () => Effect.succeed([]),
  listHiveCatalogPage: () => Effect.succeed({ context: [], workers: [] }),
  listArchivedBranchCatalogPage: () => Effect.succeed({ sessions: [] }),
  listResourceProjectionPage: () =>
    Effect.succeed({ nodes: [], throughCreatedOrder: null, hasMore: false }),
  getResourceProjectionNodes: () => Effect.succeed([]),
} satisfies Pick<
  SessionRepositoryShape,
  | 'listCatalogPage'
  | 'listProjectPage'
  | 'hasActiveProjectPath'
  | 'listByIds'
  | 'listHiveCatalogPage'
  | 'listArchivedBranchCatalogPage'
  | 'listResourceProjectionPage'
  | 'getResourceProjectionNodes'
>
