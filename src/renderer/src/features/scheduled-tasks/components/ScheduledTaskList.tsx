import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock } from 'lucide-react'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { Button } from '@/shared/ui/Button'
import { useNow } from '../hooks/useNow'
import { groupTasksByProject } from '../lib/task-groups'
import { ScheduledTaskActions } from './ScheduledTaskActions'
import {
  ScheduledTaskAttention,
  ScheduledTaskKindBadge,
  ScheduledTaskKindIcon,
  ScheduledTaskLastRunLine,
  ScheduledTaskScheduleLine,
} from './ScheduledTaskParts'

interface TaskCallbacks {
  readonly onSelect: (taskId: string) => void
  readonly onEdit: (task: ScheduledTask) => void
}

function ScheduledTaskRow({
  task,
  now,
  callbacks,
}: {
  readonly task: ScheduledTask
  readonly now: number
  readonly callbacks: TaskCallbacks
}) {
  return (
    <li
      className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0"
      data-qa="scheduled-task-row"
    >
      <div className="pt-0.5">
        <ScheduledTaskKindIcon task={task} />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="unstyled"
            onClick={() => callbacks.onSelect(task.id)}
            className="min-w-0 truncate text-left text-sm font-medium text-text-primary hover:underline"
          >
            {task.name}
          </Button>
          <ScheduledTaskKindBadge task={task} />
        </div>
        <ScheduledTaskScheduleLine task={task} now={now} />
        <ScheduledTaskLastRunLine task={task} />
        <ScheduledTaskAttention task={task} />
      </div>
      <ScheduledTaskActions task={task} onEdit={callbacks.onEdit} />
    </li>
  )
}

function EmptyState({ onCreate }: { readonly onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-bg px-6 py-12 text-center">
      <CalendarClock aria-hidden="true" className="size-6 text-text-tertiary" />
      <div>
        <p className="text-sm font-medium text-text-primary">No Scheduled tasks yet</p>
        <p className="mt-1 max-w-sm text-xs text-text-tertiary">
          A Heartbeat delivers a prompt into one Session on a schedule; a Launch schedule starts a
          new Session in a project each time it fires.
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={onCreate}>
        New Scheduled task
      </Button>
    </div>
  )
}

/** Every Scheduled task, grouped by project. */
export function ScheduledTaskList({
  onSelect,
  onEdit,
  onCreate,
}: TaskCallbacks & { readonly onCreate: () => void }) {
  const tasksQuery = useQuery(scheduledTasksListQueryOptions())
  const now = useNow()

  if (tasksQuery.isError) {
    return (
      <div role="alert" className="rounded-lg border border-error/30 bg-error/10 px-4 py-3">
        <p className="text-sm text-error-text">
          Scheduled tasks could not be loaded: {tasksQuery.error.message}
        </p>
        <Button
          variant="secondary"
          size="xs"
          className="mt-2"
          onClick={() => void tasksQuery.refetch()}
        >
          Try again
        </Button>
      </div>
    )
  }
  if (!tasksQuery.data) {
    return (
      <output aria-live="polite" className="block text-sm text-text-tertiary">
        Loading Scheduled tasks…
      </output>
    )
  }
  if (tasksQuery.data.length === 0) return <EmptyState onCreate={onCreate} />

  const callbacks = { onSelect, onEdit }
  return (
    <div className="space-y-6">
      {groupTasksByProject(tasksQuery.data).map((group) => (
        <section key={group.projectPath ?? 'no-project'} aria-label={group.label}>
          <h2
            className="mb-2 truncate text-xs font-medium text-text-tertiary"
            title={group.projectPath ?? undefined}
          >
            {group.label}
          </h2>
          <ul className="overflow-hidden rounded-lg border border-border bg-bg">
            {group.tasks.map((task) => (
              <ScheduledTaskRow key={task.id} task={task} now={now} callbacks={callbacks} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
