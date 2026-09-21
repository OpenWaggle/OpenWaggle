import type { ActionRun } from '@shared/types/action-runs'

export interface ActionRunPersistence {
  readonly recordRequest: (
    workspaceId: string,
    actionId: string,
    requestId: string,
    runId: string,
  ) => Promise<void>
  readonly get: (id: string) => Promise<ActionRun | null>
  readonly list: (workspaceId: string) => Promise<readonly ActionRun[]>
  readonly findRequest: (
    workspaceId: string,
    actionId: string,
    requestId: string,
  ) => Promise<ActionRun | null>
  readonly save: (run: ActionRun) => Promise<void>
  /** Called once when the owning Host starts, before accepting any new launches. */
  readonly interruptAfterHostLoss: () => Promise<void>
}
