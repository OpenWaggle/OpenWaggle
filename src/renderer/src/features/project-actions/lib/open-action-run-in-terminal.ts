import type { ActionManagementScope } from '@shared/types/action-management'
import type { ActionRun } from '@shared/types/action-runs'
import { openActionOutputTerminalView } from '@/features/terminal'

/** Opens the run's read-only Action output terminal view in the Session's bottom drawer. */
export function openActionRunInTerminal(
  scope: ActionManagementScope,
  run: Pick<ActionRun, 'id' | 'action'>,
) {
  if (!scope.sessionId) return false
  return openActionOutputTerminalView({
    ownerKey: scope.sessionId,
    projectPath: scope.projectPath,
    actionId: run.action.id,
    runId: run.id,
    label: run.action.name,
  })
}
