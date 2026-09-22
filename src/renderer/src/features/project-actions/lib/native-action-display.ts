import type {
  ActionDefinitionSource,
  ActionInvocation,
  ResolvedActionInvocation,
} from '@shared/types/action-definitions'
import type { ActionRun } from '@shared/types/action-runs'
import { quotePosixShellArgument, quotePowerShellArgument } from '@shared/utils/shell-argument'

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
export function resolvedActionCommand(
  invocation: ResolvedActionInvocation,
  platform = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): string {
  if (invocation.type === 'command') return invocation.command
  const words = [invocation.executable, ...invocation.args]
  if (/Windows|Win32|Win64/i.test(platform))
    return `& ${words.map(quotePowerShellArgument).join(' ')}`
  return words
    .map((word) =>
      /^[a-zA-Z0-9_./:@%+,-][a-zA-Z0-9_./:@%+=,-]*$/.test(word)
        ? word
        : quotePosixShellArgument(word),
    )
    .join(' ')
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
