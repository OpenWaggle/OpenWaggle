import type { ActionManagementScope } from '@shared/types/action-management'
import type { ActionRun } from '@shared/types/action-runs'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { rendererQueryClient } from '@/queries/query-client'
import { api } from '@/shared/lib/ipc'
import { PROJECT_ACTIONS_QUERY_ROOT } from '../hooks/useNativeActions'

/** Runs are polled only while one is active (B7/D9): read them after changing one. */
async function thenReadRuns<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation
  } finally {
    void rendererQueryClient.invalidateQueries({ queryKey: PROJECT_ACTIONS_QUERY_ROOT })
  }
}

/** Restarts a run with the action's current definition, replacing that exact run. */
export async function restartActionRun(scope: ActionManagementScope, run: ActionRun) {
  const catalog = await api.manageProjectActions({ scope, operation: { type: 'catalog' } })
  if (catalog.type !== 'catalog') throw new Error('Could not load the current action.')
  const current = catalog.catalog.actions.find(({ definition }) => definition.id === run.action.id)
  if (!current) throw new Error('This action is no longer available.')
  return thenReadRuns(
    api.manageProjectActions({
      scope,
      operation: {
        type: 'start',
        actionId: current.definition.id,
        expectedExecutionKey: actionExecutionKey(current.definition),
        requestId: crypto.randomUUID(),
        restartRunId: run.id,
      },
    }),
  )
}

export function stopActionRun(scope: ActionManagementScope, run: Pick<ActionRun, 'id'>) {
  return thenReadRuns(
    api.manageProjectActions({ scope, operation: { type: 'stop', runId: run.id } }),
  )
}
