import type { ActionManagementScope } from '@shared/types/action-management'
import { useActionRuns } from './useNativeActions'
import { useWorkspacePreparation } from './useWorkspacePreparation'

export function useWorkspaceActivityAvailable(scope: ActionManagementScope | null) {
  const runs = useActionRuns(scope)
  const preparation = useWorkspacePreparation(scope)
  return Boolean(runs.data?.length || preparation.data?.snapshot.definitions.length)
}
