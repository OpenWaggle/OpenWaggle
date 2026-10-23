import type { ScheduledTask } from '@shared/types/scheduled-task'
import { Pencil, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import {
  useDeleteScheduledTask,
  useRunScheduledTaskNow,
  useSetScheduledTaskEnabled,
} from '../hooks/useScheduledTaskMutations'

function errorText(error: unknown) {
  return error instanceof Error ? error.message : null
}

function DeleteTaskControl({
  task,
  onDeleted,
}: {
  readonly task: ScheduledTask
  readonly onDeleted?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteScheduledTask()
  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${task.name}`}
        title="Delete"
        onClick={() => setConfirming(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>
    )
  }
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs text-text-secondary">Delete this task?</span>
      <Button
        variant="danger"
        size="xs"
        disabled={remove.isPending}
        onClick={() => remove.mutate(task.id, { onSuccess: () => onDeleted?.() })}
      >
        Delete
      </Button>
      <Button variant="ghost" size="xs" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
      {remove.error ? (
        <span role="alert" className="text-xs text-error-text">
          {remove.error.message}
        </span>
      ) : null}
    </span>
  )
}

/** Enabled switch, Run now, Edit and Delete for one task, with the Host's refusal inline. */
export function ScheduledTaskActions({
  task,
  onEdit,
  onDeleted,
  align = 'end',
}: {
  readonly task: ScheduledTask
  readonly onEdit: (task: ScheduledTask) => void
  readonly onDeleted?: () => void
  readonly align?: 'start' | 'end'
}) {
  const enabled = useSetScheduledTaskEnabled()
  const runNow = useRunScheduledTaskNow()
  const error = errorText(runNow.error) ?? errorText(enabled.error)
  return (
    <div
      className={
        align === 'end'
          ? 'flex shrink-0 flex-col items-end gap-1'
          : 'flex shrink-0 flex-col items-start gap-1'
      }
    >
      <div className="flex items-center gap-1">
        <ToggleSwitch
          size="compact"
          checked={task.enabled}
          // The list beside this detail names its own switch after the task.
          label={task.enabled ? 'Pause this task' : 'Resume this task'}
          disabled={enabled.pendingTaskId === task.id}
          onCheckedChange={(next) => enabled.setEnabled(task.id, next)}
          className="mr-1"
        />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={<Play className="size-3" />}
          disabled={runNow.isPending}
          onClick={() => runNow.mutate(task.id)}
        >
          Run now
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${task.name}`}
          title="Edit"
          onClick={() => onEdit(task)}
        >
          <Pencil className="size-3.5" />
        </Button>
        <DeleteTaskControl task={task} onDeleted={onDeleted} />
      </div>
      {error ? (
        <p
          role="alert"
          className={
            align === 'end'
              ? 'max-w-xs text-right text-xs text-error-text'
              : 'max-w-xs text-xs text-error-text'
          }
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
