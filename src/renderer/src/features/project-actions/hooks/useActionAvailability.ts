import type { ActionCatalog, ActionDefinition } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { type ActionRun, isActiveActionRun } from '@shared/types/action-runs'
import { actionTaskUnavailable } from '../lib/action-task-availability'
import { useActionDiscovery } from './useNativeActions'
export function useActionAvailability(
  scope: ActionManagementScope | null,
  actions: ActionCatalog['actions'],
  runs: readonly ActionRun[],
) {
  const discovery = useActionDiscovery(
    scope,
    actions.some(({ definition }) => definition.invocation.type === 'task'),
  )
  return (definition: ActionDefinition) => {
    const active = runs.some(
      (run) =>
        run.action.id === definition.id && isActiveActionRun(run) && !run.action.allowConcurrent,
    )
    return active ? undefined : actionTaskUnavailable(definition.invocation, discovery.data)
  }
}
