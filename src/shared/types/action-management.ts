import type { ActionCatalog, ActionCatalogEdit, ProjectTaskDiscovery } from './action-definitions'
import type { ActionOutputSnapshot, ActionRun } from './action-runs'
import type { PreparationOperation, WorkspacePreparation } from './workspace-preparation'

/** The Host derives the workspace from the Session; clients cannot supply an arbitrary cwd. */
export interface ActionManagementScope {
  readonly projectPath: string
  readonly sessionId?: string
  readonly workspaceId?: string
}

export type ActionManagementOperation =
  | PreparationOperation
  | { readonly type: 'retained-preparation' }
  | { readonly type: 'catalog' }
  | { readonly type: 'discover' }
  | { readonly type: 'edit'; readonly revision: string; readonly edit: ActionCatalogEdit }
  | { readonly type: 'runs' }
  | {
      readonly type: 'start'
      readonly actionId: string
      readonly requestId: string
      readonly restartRunId?: string
    }
  | { readonly type: 'output'; readonly runId: string; readonly afterOffset: number }
  | { readonly type: 'stop'; readonly runId: string }

export interface ActionManagementRequest {
  readonly scope: ActionManagementScope
  readonly operation: ActionManagementOperation
}

export type ActionManagementResult =
  | { readonly type: 'preparation'; readonly preparation: WorkspacePreparation | null }
  | {
      readonly type: 'retained-preparation'
      readonly workspaces: readonly {
        readonly path: string
        readonly preparation: WorkspacePreparation
        /** The checkout at this path no longer matches the recorded preparation generation. */
        readonly generationMismatch?: boolean
      }[]
    }
  | { readonly type: 'catalog'; readonly catalog: ActionCatalog }
  | { readonly type: 'discovery'; readonly discovery: ProjectTaskDiscovery }
  | { readonly type: 'runs'; readonly runs: readonly ActionRun[] }
  | { readonly type: 'run'; readonly run: ActionRun }
  | { readonly type: 'output'; readonly output: ActionOutputSnapshot }
