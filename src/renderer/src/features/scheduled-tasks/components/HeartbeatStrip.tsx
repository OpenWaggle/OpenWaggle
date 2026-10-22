import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, HeartPulse, Pause, Play } from 'lucide-react'
import { scheduledTasksForSessionQueryOptions } from '@/queries/scheduled-tasks'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { useNow } from '../hooks/useNow'
import { useOpenScheduledTasksPage } from '../hooks/useOpenScheduledSession'
import { useSetScheduledTaskEnabled } from '../hooks/useScheduledTaskMutations'
import { describeSchedule } from '../lib/schedule-presets'
import { formatAbsoluteTime, inlineNextRunText } from '../lib/task-format'
import { heartbeatsForSession } from '../lib/task-groups'

function heartbeatStatusText(task: ScheduledTask, now: number) {
  if (task.attention) return task.attention.message
  return inlineNextRunText(task, now)
}

function HeartbeatRow({ task, now }: { readonly task: ScheduledTask; readonly now: number }) {
  const enabled = useSetScheduledTaskEnabled()
  const openPage = useOpenScheduledTasksPage()
  const Icon = task.attention ? AlertTriangle : HeartPulse
  const nextAt = task.enabled && task.waitingSince === null ? task.nextRunAt : null
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
        task.attention
          ? 'border-warning/40 bg-warning/10 text-text-primary'
          : 'border-border-light bg-bg-secondary/60 text-text-secondary',
      )}
      data-qa="heartbeat-strip"
    >
      <Icon
        aria-hidden="true"
        className={cn('size-3.5 shrink-0', task.attention ? 'text-warning' : 'text-text-tertiary')}
      />
      <span
        className="min-w-0 flex-1 truncate"
        title={nextAt === null ? task.name : `${task.name} · ${formatAbsoluteTime(nextAt)}`}
      >
        Heartbeat · {describeSchedule(task.schedule)} · {heartbeatStatusText(task, now)}
      </span>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={task.enabled ? <Pause className="size-3" /> : <Play className="size-3" />}
        disabled={enabled.isPending}
        onClick={() => enabled.setEnabled(task.id, !task.enabled)}
      >
        {task.enabled ? 'Pause' : 'Resume'}
      </Button>
      <Button variant="ghost" size="xs" onClick={() => openPage(task.id)}>
        Open
      </Button>
    </div>
  )
}

/**
 * The Heartbeat strip (CONTEXT.md): beside the composer, never inside it, for each Heartbeat
 * whose target is this Session.
 */
export function HeartbeatStrip({
  sessionId,
  className,
}: {
  readonly sessionId: string | null
  readonly className?: string
}) {
  const tasksQuery = useQuery(scheduledTasksForSessionQueryOptions(sessionId))
  const now = useNow()
  if (sessionId === null) return null
  const heartbeats = heartbeatsForSession(tasksQuery.data ?? [], sessionId)
  if (heartbeats.length === 0) return null
  return (
    <div className={cn('space-y-1 pb-2', className)}>
      {heartbeats.map((task) => (
        <HeartbeatRow key={task.id} task={task} now={now} />
      ))}
    </div>
  )
}
