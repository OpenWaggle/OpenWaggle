import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import {
  CalendarClock,
  CirclePlay,
  Ellipsis,
  HeartPulse,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import {
  describeSchedule,
  heartbeatSummaryText,
  heartbeatsForSession,
  lastCheckText,
  launchScheduleForSession,
  nextRunAbsoluteText,
  nextRunText,
  useDeleteScheduledTask,
  useOpenScheduledTask,
  useRunScheduledTaskNow,
  useSetScheduledTaskEnabled,
  useShowScheduledTasks,
} from '@/features/scheduled-tasks'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS, MENU_SECTION_LABEL_CLASS } from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'
import { SessionSummarySection } from './SessionSummaryPrimitives'

const MENU_POPOVER_CLASS = 'w-56 overflow-hidden p-1.5'

function nextRunTooltip(task: ScheduledTask) {
  const check = lastCheckText(task, Date.now())
  if (check) return check
  const next = nextRunAbsoluteText(task)
  if (!task.enabled || next === null || task.waitingSince !== null) {
    return nextRunText(task, Date.now())
  }
  return `Next run: ${next}`
}

function MenuItem({
  icon,
  children,
  danger = false,
  onSelect,
}: {
  readonly icon: ReactNode
  readonly children: ReactNode
  readonly danger?: boolean
  readonly onSelect: () => void
}) {
  return (
    <Button
      variant="unstyled"
      role="menuitem"
      className={danger ? `${DENSE_MENU_ITEM_CLASS} text-error-text` : DENSE_MENU_ITEM_CLASS}
      onClick={onSelect}
    >
      <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center">
        {icon}
      </span>
      {children}
    </Button>
  )
}

/** The row's quick actions, inside the Summary so its outside-click dismissal leaves it alone. */
function TaskMenuItems({
  task,
  close,
  onDelete,
}: {
  readonly task: ScheduledTask
  readonly close: () => void
  readonly onDelete: (task: ScheduledTask) => void
}) {
  const openTask = useOpenScheduledTask()
  const show = useShowScheduledTasks()
  const runNow = useRunScheduledTaskNow()
  const enabled = useSetScheduledTaskEnabled()
  const select = (action: () => void) => () => {
    close()
    action()
  }
  return (
    <>
      <div className={MENU_SECTION_LABEL_CLASS}>{task.name}</div>
      <MenuItem
        icon={<CalendarClock className="size-4" />}
        onSelect={select(() => openTask(task.id))}
      >
        Open
      </MenuItem>
      <MenuItem icon={<Play className="size-4" />} onSelect={select(() => runNow.mutate(task.id))}>
        Run now
      </MenuItem>
      <MenuItem
        icon={task.enabled ? <Pause className="size-4" /> : <CirclePlay className="size-4" />}
        onSelect={select(() => enabled.setEnabled(task.id, !task.enabled))}
      >
        {task.enabled ? 'Pause' : 'Resume'}
      </MenuItem>
      <MenuItem
        icon={<Pencil className="size-4" />}
        onSelect={select(() => show({ kind: 'edit', taskId: task.id }))}
      >
        Edit
      </MenuItem>
      <MenuItem danger icon={<Trash2 className="size-4" />} onSelect={select(() => onDelete(task))}>
        Delete…
      </MenuItem>
    </>
  )
}

function DeleteConfirmation({
  task,
  onDone,
}: {
  readonly task: ScheduledTask
  readonly onDone: () => void
}) {
  const remove = useDeleteScheduledTask()
  return (
    <div role="alert" className="flex items-center gap-2 px-2 py-1 text-xs text-text-secondary">
      <span className="min-w-0 flex-1 truncate">Delete {task.name}?</span>
      <Button
        variant="danger"
        size="xs"
        disabled={remove.isPending}
        onClick={() => remove.mutate(task.id, { onSuccess: onDone })}
      >
        Delete
      </Button>
      <Button variant="ghost" size="xs" onClick={onDone}>
        Cancel
      </Button>
      {remove.error ? (
        <span className="min-w-0 truncate text-error-text" title={remove.error.message}>
          {remove.error.message}
        </span>
      ) : null}
    </div>
  )
}

function TaskRow({
  task,
  label,
  value,
  icon,
  deleting,
  onDelete,
  onDeleteDone,
}: {
  readonly task: ScheduledTask
  readonly label: string
  readonly value: string
  readonly icon: ReactNode
  /** The row's delete confirmation shows under it, next to the task it names. */
  readonly deleting: boolean
  readonly onDelete: (task: ScheduledTask) => void
  readonly onDeleteDone: () => void
}) {
  const openTask = useOpenScheduledTask()
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <>
      <div className="group flex min-h-8 items-center rounded-md transition-colors hover:bg-bg-hover">
        <Button
          variant="unstyled"
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left"
          aria-label={`Open ${task.name}`}
          title={nextRunTooltip(task)}
          onClick={() => openTask(task.id)}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenuOpen(true)
          }}
        >
          <span aria-hidden="true" className="shrink-0 text-text-tertiary">
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{label}</span>
          <span
            className={
              task.attention
                ? 'shrink-0 text-xs text-warning'
                : 'shrink-0 text-xs text-text-tertiary'
            }
          >
            {task.attention ? 'Needs attention' : value}
          </span>
        </Button>
        <Popover
          escapeClipping
          open={menuOpen}
          onOpenChange={setMenuOpen}
          placement="bottom-end"
          role="menu"
          className={MENU_POPOVER_CLASS}
          trigger={({ isOpen, toggle }) => (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${task.name} actions`}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
              onClick={toggle}
            >
              <Ellipsis className="size-3.5" />
            </Button>
          )}
        >
          <TaskMenuItems task={task} close={() => setMenuOpen(false)} onDelete={onDelete} />
        </Popover>
      </div>
      {deleting ? <DeleteConfirmation task={task} onDone={onDeleteDone} /> : null}
    </>
  )
}

/**
 * The Session Summary's Scheduled section (CONTEXT.md, Scheduled tasks): the Heartbeats that
 * run in this Session, or the Launch schedule that started it, as Codex's thread summary lists
 * them. A row opens the task where the user is; its menu holds the quick actions.
 */
export function ScheduledSummarySection({ sessionId }: { readonly sessionId: string }) {
  const { data: tasks } = useQuery(scheduledTasksListQueryOptions())
  if (!tasks) return null
  const heartbeats = heartbeatsForSession(tasks, sessionId)
  const launchedBy = launchScheduleForSession(tasks, sessionId)
  if (heartbeats.length === 0 && launchedBy === null) return null
  return <ScheduledRows sessionId={sessionId} heartbeats={heartbeats} launchedBy={launchedBy} />
}

function ScheduledRows({
  sessionId,
  heartbeats,
  launchedBy,
}: {
  readonly sessionId: string
  readonly heartbeats: readonly ScheduledTask[]
  readonly launchedBy: ScheduledTask | null
}) {
  const show = useShowScheduledTasks()
  const [expanded, setExpanded] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  return (
    <SessionSummarySection
      id="scheduled"
      title="Scheduled"
      count={heartbeats.length + (launchedBy ? 1 : 0)}
      expanded={expanded}
      onExpandedChange={setExpanded}
      actions={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New Heartbeat for this Session"
          title="New Heartbeat for this Session"
          onClick={() => show({ kind: 'new', defaults: { kind: 'heartbeat', sessionId } })}
        >
          <Plus className="size-3.5" />
        </Button>
      }
    >
      {heartbeats.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          label={task.name}
          value={heartbeatSummaryText(task) ?? describeSchedule(task.schedule)}
          icon={<HeartPulse className="size-4" />}
          deleting={deletingId === task.id}
          onDelete={(next) => setDeletingId(next.id)}
          onDeleteDone={() => setDeletingId(null)}
        />
      ))}
      {launchedBy ? (
        <TaskRow
          task={launchedBy}
          label={`Started by ${launchedBy.name}`}
          value={describeSchedule(launchedBy.schedule)}
          icon={<CalendarClock className="size-4" />}
          deleting={deletingId === launchedBy.id}
          onDelete={(next) => setDeletingId(next.id)}
          onDeleteDone={() => setDeletingId(null)}
        />
      ) : null}
    </SessionSummarySection>
  )
}
