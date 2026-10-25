import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { SessionsToolScheduledTask } from '@/features/chat/lib/sessions-tool-schedule'
import type { ToolCallResultPayload } from '@/features/chat/lib/tool-call-block'
import {
  useDeleteScheduledTask,
  useOpenScheduledTask,
  useSetScheduledTaskEnabled,
} from '@/features/scheduled-tasks'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { Button } from '@/shared/ui/Button'
import { ToolCallBlock } from './ToolCallBlock'

interface ScheduledTaskToolCallBlockProps {
  readonly name: string
  readonly args: string
  readonly state: string
  readonly result?: ToolCallResultPayload
  readonly isStreaming?: boolean
  readonly resultNotRecorded?: boolean
  readonly scheduled: SessionsToolScheduledTask
}

/** The task as the Host knows it now, from the shared task list; null when it no longer exists. */
function useLiveScheduledTask(taskId: string | null) {
  const tasks = useQuery({ ...scheduledTasksListQueryOptions(), enabled: taskId !== null })
  if (taskId === null || tasks.data === undefined) return { loaded: false, task: null } as const
  return { loaded: true, task: tasks.data.find((task) => task.id === taskId) ?? null } as const
}

/**
 * A hive-tool row over a Scheduled task names the task by its current name. The row of a call
 * that created or changed a task also carries its Open, Pause/Resume and Delete controls, which
 * follow the task list, so they show the task's state now; a task deleted since says so instead.
 */
export function ScheduledTaskToolCallBlock({
  scheduled,
  ...props
}: ScheduledTaskToolCallBlockProps) {
  const live = useLiveScheduledTask(scheduled.taskId)
  const name = live.task?.name ?? scheduled.name
  return (
    <ToolCallBlock
      {...props}
      hive={{
        target: name ? { title: name, agentName: null, isWorker: false } : null,
        headerAddon: scheduledTaskHeaderAddon(scheduled, live),
      }}
    />
  )
}

function scheduledTaskHeaderAddon(
  scheduled: SessionsToolScheduledTask,
  live: ReturnType<typeof useLiveScheduledTask>,
) {
  if (scheduled.refusal !== null) {
    return (
      <span className="shrink-0 text-xs text-text-tertiary" title={scheduled.refusal}>
        refused
      </span>
    )
  }
  return scheduled.controlled ? (
    <ScheduledTaskRowAddon loaded={live.loaded} task={live.task} />
  ) : null
}

function ScheduledTaskRowAddon({
  loaded,
  task,
}: {
  readonly loaded: boolean
  readonly task: ScheduledTask | null
}) {
  if (task) return <ScheduledTaskRowControls task={task} />
  if (!loaded) return null
  return <span className="shrink-0 text-xs text-text-tertiary">deleted</span>
}

function ScheduledTaskRowControls({ task }: { readonly task: ScheduledTask }) {
  const openTask = useOpenScheduledTask()
  const enabled = useSetScheduledTaskEnabled()
  const toggle = task.enabled ? 'Pause' : 'Resume'
  return (
    <>
      {task.enabled ? null : <span className="shrink-0 text-xs text-text-tertiary">Paused</span>}
      <Button
        variant="ghost"
        size="xs"
        leftIcon={<SquareArrowOutUpRight aria-hidden="true" className="size-3" />}
        aria-label={`Open scheduled task: ${task.name}`}
        onClick={() => openTask(task.id)}
      >
        Open
      </Button>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={
          task.enabled ? (
            <Pause aria-hidden="true" className="size-3" />
          ) : (
            <Play aria-hidden="true" className="size-3" />
          )
        }
        aria-label={`${toggle} scheduled task: ${task.name}`}
        disabled={enabled.pendingTaskId === task.id}
        onClick={() => enabled.setEnabled(task.id, !task.enabled)}
      >
        {toggle}
      </Button>
      <DeleteScheduledTaskControl task={task} />
      {enabled.error ? (
        <span role="alert" className="min-w-0 truncate text-xs text-error-text">
          {enabled.error.message}
        </span>
      ) : null}
    </>
  )
}

function DeleteScheduledTaskControl({ task }: { readonly task: ScheduledTask }) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteScheduledTask()
  if (!confirming) {
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete scheduled task: ${task.name}`}
        title="Delete"
        onClick={() => setConfirming(true)}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </Button>
    )
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="text-xs text-text-secondary">Delete this task?</span>
      <Button
        variant="danger"
        size="xs"
        disabled={remove.isPending}
        onClick={() => remove.mutate(task.id)}
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
