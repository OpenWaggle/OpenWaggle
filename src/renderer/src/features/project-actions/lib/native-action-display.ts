import type {
  ActionDefinitionSource,
  ActionInvocation,
  ResolvedActionInvocation,
} from '@shared/types/action-definitions'
import type { ActionRun } from '@shared/types/action-runs'

export const actionSourceLabels: Record<ActionDefinitionSource, string> = {
  local: 'Only on this device',
  project: 'Shared in project',
  override: 'Locally overridden',
}
export function actionInvocationLabel(invocation: ActionInvocation): string {
  return invocation.type === 'command'
    ? invocation.command
    : `${invocation.task.task} · ${invocation.task.source}`
}
export function resolvedActionCommand(invocation: ResolvedActionInvocation): string {
  return invocation.type === 'command'
    ? invocation.command
    : [invocation.executable, ...invocation.args].join(' ')
}
export function actionRunLabel(run: ActionRun): string {
  if (run.ready && run.status === 'running') return 'Ready'
  return {
    starting: 'Starting',
    running: 'Running',
    stopping: 'Stopping',
    completed: 'Completed',
    failed: 'Failed',
    stopped: 'Stopped',
    interrupted: 'Interrupted',
  }[run.status]
}
