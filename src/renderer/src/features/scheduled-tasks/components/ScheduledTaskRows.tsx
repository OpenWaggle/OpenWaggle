import type { ScheduledTask } from '@shared/types/scheduled-task'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { useNow } from '../hooks/useNow'
import { useSetScheduledTaskEnabled } from '../hooks/useScheduledTaskMutations'
import { describeSchedule } from '../lib/schedule-presets'
import { nextRunText } from '../lib/task-format'
import { ScheduledTaskKindIcon } from './ScheduledTaskParts'

export interface ScheduledTaskRowGroup {
  readonly id: string
  readonly label: string
  readonly title?: string
  readonly tasks: readonly ScheduledTask[]
  /** Shown instead of rows when the group has none. */
  readonly emptyText?: string
}

function rowDetail(task: ScheduledTask, now: number) {
  if (task.attention) return task.attention.message
  return `${describeSchedule(task.schedule)} · ${nextRunText(task, now)}`
}

function TaskRow({
  task,
  now,
  selected,
  onSelect,
}: {
  readonly task: ScheduledTask
  readonly now: number
  readonly selected: boolean
  readonly onSelect: (taskId: string) => void
}) {
  const enabled = useSetScheduledTaskEnabled()
  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-md pr-2 transition-colors',
        selected ? 'bg-bg-hover' : 'hover:bg-bg-hover/60',
      )}
      data-qa="scheduled-task-row"
    >
      <Button
        variant="unstyled"
        aria-current={selected ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 text-left"
        onClick={() => onSelect(task.id)}
      >
        <ScheduledTaskKindIcon task={task} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-text-primary">{task.name}</span>
          <span
            className={cn(
              'block truncate text-xs',
              task.attention ? 'text-warning' : 'text-text-tertiary',
            )}
          >
            {rowDetail(task, now)}
          </span>
        </span>
      </Button>
      {task.attention ? (
        <AlertTriangle aria-label="Needs attention" className="size-4 shrink-0 text-warning" />
      ) : (
        <ToggleSwitch
          size="compact"
          checked={task.enabled}
          label={`${task.name} enabled`}
          disabled={enabled.pendingTaskId === task.id}
          onCheckedChange={(next) => enabled.setEnabled(task.id, next)}
        />
      )}
    </li>
  )
}

/** Task rows in labelled groups, shared by the Right panel and Settings. */
export function ScheduledTaskRows({
  groups,
  selectedTaskId,
  onSelect,
}: {
  readonly groups: readonly ScheduledTaskRowGroup[]
  readonly selectedTaskId: string | null
  readonly onSelect: (taskId: string) => void
}) {
  const now = useNow()
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label}>
          <h3
            className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-text-tertiary"
            title={group.title}
          >
            {group.label}
          </h3>
          {group.tasks.length === 0 ? (
            <p className="px-2 text-xs text-text-muted">{group.emptyText ?? 'None'}</p>
          ) : (
            <ul className="space-y-0.5">
              {group.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  now={now}
                  selected={task.id === selectedTaskId}
                  onSelect={onSelect}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
