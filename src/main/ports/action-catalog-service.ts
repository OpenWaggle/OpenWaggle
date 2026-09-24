import type {
  ActionCatalog,
  ActionCatalogEdit,
  PreparationReview,
  ProjectTaskDiscovery,
} from '@shared/types/action-definitions'
import { Context } from 'effect'
import type { Effect } from 'effect/Effect'

/** Project identity is its registered root; workspace selects branch-specific shared definitions. */
export interface ActionCatalogScope {
  readonly projectPath: string
  readonly workspacePath: string
}

export interface ActionCatalogServiceShape {
  readonly read: (scope: ActionCatalogScope) => Effect<ActionCatalog, Error>
  readonly edit: (
    scope: ActionCatalogScope,
    revision: string,
    edit: ActionCatalogEdit,
  ) => Effect<ActionCatalog, Error>
  /** Host-only compensation for a failed workspace snapshot save. */
  readonly restorePreparationReview: (
    scope: ActionCatalogScope,
    granted: PreparationReview,
    previous: PreparationReview | undefined,
  ) => Effect<ActionCatalog, Error>
  readonly discover: (workspacePath: string) => Effect<ProjectTaskDiscovery, Error>
}

export class ActionCatalogService extends Context.Tag('@openwaggle/ActionCatalogService')<
  ActionCatalogService,
  ActionCatalogServiceShape
>() {}
