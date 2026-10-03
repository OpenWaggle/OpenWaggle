import type { ActionManagementScope } from '@shared/types/action-management'
import type { ActionRun } from '@shared/types/action-runs'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { api } from '@/shared/lib/ipc'

/** Restarts a run with the action's current definition, replacing that exact run. */
export async function restartActionRun(scope: ActionManagementScope, run: ActionRun) {
  const catalog = await api.manageProjectActions({ scope, operation: { type: 'catalog' } })
  if (catalog.type !== 'catalog') throw new Error('Could not load the current action.')
  const current = catalog.catalog.actions.find(({ definition }) => definition.id === run.action.id)
  if (!current) throw new Error('This action is no longer available.')
  return api.manageProjectActions({
    scope,
    operation: {
      type: 'start',
      actionId: current.definition.id,
      expectedExecutionKey: actionExecutionKey(current.definition),
      requestId: crypto.randomUUID(),
      restartRunId: run.id,
    },
  })
}

export function stopActionRun(scope: ActionManagementScope, run: Pick<ActionRun, 'id'>) {
  return api.manageProjectActions({ scope, operation: { type: 'stop', runId: run.id } })
}
