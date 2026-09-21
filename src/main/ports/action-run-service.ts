import type { ActionOutputSnapshot, ActionRun } from '@shared/types/action-runs'
import { Context } from 'effect'
import type { Effect } from 'effect/Effect'
import type { ActionCatalogScope } from './action-catalog-service'

export interface ActionRunWorkspace extends ActionCatalogScope {
  readonly workspaceId: string
  readonly sessionId?: string
}
export interface StartManagedActionInput {
  readonly workspace: ActionRunWorkspace
  readonly actionId: string
  readonly requestId: string
  readonly expectedExecutionKey?: string
  readonly restartRunId?: string
  /** Internal read-only reuse: never falls through to launching a replacement. */
  readonly reuseRunId?: string
}

export interface ActionRunServiceShape {
  readonly start: (input: StartManagedActionInput) => Effect<ActionRun, Error>
  readonly list: (workspaceId: string) => Effect<readonly ActionRun[], Error>
  readonly output: (
    workspaceId: string,
    runId: string,
    afterOffset: number,
  ) => Effect<ActionOutputSnapshot, Error>
  readonly stop: (workspaceId: string, runId: string) => Effect<ActionRun, Error>
  readonly stopWorkspaceRuns: (workspaceId: string) => Effect<void, Error>
  readonly stopWorkspaceServices: (workspaceId: string) => Effect<void, Error>
  readonly withWorkspaceMutation: <A, E, R>(
    workspaceId: string,
    operation: Effect<A, E, R>,
  ) => Effect<A, E, R>
  readonly recoverAfterHostLoss: Effect<void, Error>
}

export class ActionRunService extends Context.Tag('@openwaggle/ActionRunService')<
  ActionRunService,
  ActionRunServiceShape
>() {}
