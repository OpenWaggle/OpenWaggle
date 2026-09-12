import * as Effect from 'effect/Effect'
import type { SessionRepositoryShape } from '../../ports/session-repository'

/** Empty catalog behavior for tests that exercise unrelated SessionRepository capabilities. */
export const emptySessionCatalogMethods = {
  listCatalogPage: () => Effect.succeed({ sessions: [] }),
  listByIds: () => Effect.succeed([]),
  listHiveCatalogPage: () => Effect.succeed({ context: [], workers: [] }),
  listArchivedBranchCatalogPage: () => Effect.succeed({ sessions: [] }),
} satisfies Pick<
  SessionRepositoryShape,
  'listCatalogPage' | 'listByIds' | 'listHiveCatalogPage' | 'listArchivedBranchCatalogPage'
>
