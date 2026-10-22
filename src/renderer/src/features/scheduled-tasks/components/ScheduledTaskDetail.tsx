import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { scheduledTaskDetailQueryOptions } from '@/queries/scheduled-tasks'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { useNow } from '../hooks/useNow'
import { useOpenScheduledSession } from '../hooks/useOpenScheduledSession'
import { differingTimeZone, NOTIFICATION_POLICY_LABELS } from '../lib/task-format'
import { ScheduledTaskActions } from './ScheduledTaskActions'
import {
  ScheduledTaskAttention,
  ScheduledTaskKindBadge,
  ScheduledTaskKindIcon,
  ScheduledTaskLastRunLine,
  ScheduledTaskScheduleLine,
} from './ScheduledTaskParts'
import { ScheduledTaskRunHistory } from './ScheduledTaskRunHistory'

function TargetLine({ task }: { readonly task: ScheduledTask }) {
  const openSession = useOpenScheduledSession()
  const { target } = task
  if (target.kind === 'heartbeat') {
    return (
      <span>
        Delivers into{' '}
        <Button variant="link" size="none" onClick={() => openSession(target.sessionId)}>
          its Session
        </Button>
      </span>
    )
  }
  const workspace = target.workspace === 'local' ? 'the local checkout' : 'a new worktree'
  const details = [
    target.modelId,
    target.thinkingLevel ? `thinking ${target.thinkingLevel}` : null,
    target.agentDefinitionName ? `agent ${target.agentDefinitionName}` : null,
    target.archiveFinishedSessions ? 'archives finished runs' : null,
  ].filter((part): part is string => part !== null && part !== undefined)
  return (
    <span>
      Launches a Session in {projectName(target.projectPath)} in {workspace}
      {details.length > 0 ? ` · ${details.join(' · ')}` : ''}
    </span>
  )
}

function TaskSummary({
  task,
  onEdit,
  onDeleted,
}: {
  readonly task: ScheduledTask
  readonly onEdit: (task: ScheduledTask) => void
  readonly onDeleted: () => void
}) {
  const now = useNow()
  return (
    <section className="space-y-3 rounded-lg border border-border bg-bg px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="pt-1">
          <ScheduledTaskKindIcon task={task} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base font-semibold text-text-primary">{task.name}</h1>
            <ScheduledTaskKindBadge task={task} />
          </div>
          <ScheduledTaskScheduleLine task={task} now={now} />
          <ScheduledTaskLastRunLine task={task} />
        </div>
        <ScheduledTaskActions task={task} onEdit={onEdit} onDeleted={onDeleted} />
      </div>
      <ScheduledTaskAttention task={task} />
      <div className="space-y-1 text-xs text-text-tertiary">
        <div>
          <TargetLine task={task} />
        </div>
        <div>
          Notifies on {NOTIFICATION_POLICY_LABELS[task.notificationPolicy].toLowerCase()} · Created
          by {task.creator.label} · {String(task.runCount)} runs
        </div>
      </div>
      <p className="whitespace-pre-wrap rounded-md bg-bg-secondary px-3 py-2 text-xs text-text-secondary">
        {task.prompt}
      </p>
    </section>
  )
}

/** One task's settings and its full history of Scheduled task runs. */
export function ScheduledTaskDetail({
  taskId,
  onBack,
  onEdit,
}: {
  readonly taskId: string
  readonly onBack: () => void
  readonly onEdit: (task: ScheduledTask) => void
}) {
  const taskQuery = useQuery(scheduledTaskDetailQueryOptions(taskId))
  const task = taskQuery.data
  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="xs"
        leftIcon={<ArrowLeft className="size-3" />}
        onClick={onBack}
      >
        All Scheduled tasks
      </Button>
      {taskQuery.isError ? (
        <p role="alert" className="text-sm text-error-text">
          {taskQuery.error.message}
        </p>
      ) : null}
      {task ? (
        <>
          <TaskSummary task={task} onEdit={onEdit} onDeleted={onBack} />
          <ScheduledTaskRunHistory taskId={task.id} timeZone={differingTimeZone(task)} />
        </>
      ) : null}
    </div>
  )
}
