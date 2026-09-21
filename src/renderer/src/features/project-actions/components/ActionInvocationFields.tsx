import type { ActionInvocation } from '@shared/types/action-definitions'
import { useId } from 'react'
import { Button } from '@/shared/ui/Button'
import { Textarea } from '@/shared/ui/Textarea'
import { TextInput } from '@/shared/ui/TextInput'
import { actionInvocationLabel } from '../lib/native-action-display'

const COMMAND_ROWS = 3
export function ActionInvocationFields({
  invocation,
  onChange,
  onChangeTask,
}: {
  readonly invocation: ActionInvocation
  readonly onChange: (invocation: ActionInvocation) => void
  readonly onChangeTask: () => void
}) {
  const id = useId()
  const hasRemovedVariables =
    invocation.type === 'command' && /T3CODE_(PROJECT_ROOT|WORKTREE_PATH)/.test(invocation.command)
  return (
    <>
      {invocation.type === 'command' ? (
        <>
          <label
            htmlFor={`${id}-command`}
            className="block space-y-1.5 text-xs text-text-secondary"
          >
            <span>Command</span>
            <Textarea
              id={`${id}-command`}
              variant="mono"
              rows={COMMAND_ROWS}
              value={invocation.command}
              onChange={(event) => onChange({ ...invocation, command: event.target.value })}
              placeholder="pnpm dev"
              required
            />
          </label>
          <label
            htmlFor={`${id}-directory`}
            className="block space-y-1.5 text-xs text-text-secondary"
          >
            <span>Working directory · relative to workspace</span>
            <TextInput
              id={`${id}-directory`}
              value={invocation.directory}
              onChange={(event) => onChange({ ...invocation, directory: event.target.value })}
              placeholder="."
            />
          </label>
        </>
      ) : (
        <div className="rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">Project task</span>
            <Button variant="ghost" size="xs" onClick={onChangeTask}>
              Change task
            </Button>
          </div>
          <code className="mt-2 block break-all text-sm">{actionInvocationLabel(invocation)}</code>
        </div>
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
            onClick={() => {
              if (invocation.type === 'command')
                onChange({
                  ...invocation,
                  command: invocation.command
                    .replaceAll('T3CODE_PROJECT_ROOT', 'OPENWAGGLE_PROJECT_ROOT')
                    .replaceAll('T3CODE_WORKTREE_PATH', 'OPENWAGGLE_WORKTREE_PATH'),
                })
            }}
          >
            Review updated command
          </Button>
        </div>
      ) : null}
    </>
  )
}
