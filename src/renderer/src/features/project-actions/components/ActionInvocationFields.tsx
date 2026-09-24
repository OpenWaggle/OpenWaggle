import type { ActionInvocation } from '@shared/types/action-definitions'
import type { ActionManagementScope } from '@shared/types/action-management'
import { projectTaskArguments } from '@shared/utils/project-task-command'
import { useId } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import { useActionDiscovery } from '../hooks/useNativeActions'
import { findDiscoveredTask } from '../lib/action-task-availability'
import { resolvedActionCommand } from '../lib/native-action-display'

const COMMAND_ROWS = 2
interface InvocationProps {
  readonly invocation: ActionInvocation
  readonly onChange: (invocation: ActionInvocation) => void
}
export function ActionInvocationFields({
  scope,
  invocation,
  onChange,
}: InvocationProps & {
  readonly scope: ActionManagementScope
}) {
  const id = useId()
  const discovery = useActionDiscovery(scope, invocation.type === 'task')
  const task =
    invocation.type === 'task' ? findDiscoveredTask(invocation.task, discovery.data) : undefined
  const preview = task?.runner
    ? resolvedActionCommand({
        type: 'executable',
        executable: task.runner,
        args: projectTaskArguments(task.reference),
        cwd: task.reference.directory,
      })
    : ''
  const command = invocation.type === 'command' ? invocation.command : preview
  const directory = invocation.type === 'command' ? invocation.directory : invocation.task.directory
  const hasRemovedVariables = /T3CODE_(PROJECT_ROOT|WORKTREE_PATH)/.test(command)
  return (
    <div className="space-y-2">
      <div className="space-y-1.5 text-xs text-text-secondary">
        <label htmlFor={`${id}-command`} className="block">
          Command
        </label>
        <Textarea
          id={`${id}-command`}
          variant="mono"
          rows={COMMAND_ROWS}
          value={command}
          onChange={(event) =>
            onChange({ type: 'command', command: event.target.value, directory })
          }
          placeholder={invocation.type === 'task' ? 'Project script unavailable' : 'e.g. pnpm dev'}
          required={invocation.type === 'command'}
        />
      </div>
      {invocation.type === 'task' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-tertiary">
          <span className="break-all">
            Linked to {invocation.task.source} → {invocation.task.task}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onChange({ type: 'command', command: preview, directory })}
          >
            Use as custom command
          </Button>
          <p className="w-full">
            Future runs use the script in the session’s workspace. Editing the command makes it
            custom.
          </p>
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">Runs in the selected session’s workspace.</p>
      )}
      {hasRemovedVariables ? (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-border p-3 text-xs text-text-secondary"
        >
          <p>
            This command uses variables from the previous integration. Review a replacement with
            OpenWaggle’s project and workspace variables.
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              onChange({
                type: 'command',
                directory,
                command: command
                  .replaceAll('T3CODE_PROJECT_ROOT', 'OPENWAGGLE_PROJECT_ROOT')
                  .replaceAll('T3CODE_WORKTREE_PATH', 'OPENWAGGLE_WORKTREE_PATH'),
              })
            }
          >
            Review updated command
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function ActionDirectoryFields({ invocation, onChange }: InvocationProps) {
  const id = useId()
  const directory = invocation.type === 'command' ? invocation.directory : invocation.task.directory
  return (
    <label htmlFor={id} className="block space-y-1.5 text-xs text-text-secondary">
      <span>Working directory · relative to workspace</span>
      <TextInput
        id={id}
        value={directory}
        readOnly={invocation.type === 'task'}
        onChange={(event) => {
          if (invocation.type === 'command')
            onChange({ ...invocation, directory: event.target.value })
        }}
        placeholder="."
      />
      {invocation.type === 'task' ? <span>Defined by the selected script.</span> : null}
    </label>
  )
}
