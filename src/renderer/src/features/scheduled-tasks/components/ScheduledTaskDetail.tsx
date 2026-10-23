import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { scheduledTaskDetailQueryOptions } from '@/queries/scheduled-tasks'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { useNow } from '../hooks/useNow'
import { useOpenScheduledSession } from '../hooks/useOpenScheduledSession'
import {
  differingTimeZone,
  NOTIFICATION_POLICY_LABELS,
  SCHEDULED_TASK_KIND_LABELS,
} from '../lib/task-format'
import type { ScheduledTaskEditorLayout } from './EditorTargetFields'
import { ScheduledTaskActions } from './ScheduledTaskActions'
import {
  ScheduledTaskAttention,
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
        Into{' '}
        <Button variant="link" size="none" onClick={() => openSession(target.sessionId)}>
          its Session
        </Button>{' '}
        when it is idle
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
      A new Session in {projectName(target.projectPath)}, in {workspace}
      {details.length > 0 ? ` · ${details.join(' · ')}` : ''}
    </span>
  )
}

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-text-tertiary">{label}</dt>
      <dd className="min-w-0 text-text-secondary">{children}</dd>
    </>
  )
}

function TaskSettings({
  task,
  layout,
}: {
  readonly task: ScheduledTask
  readonly layout: ScheduledTaskEditorLayout
}) {
  const now = useNow()
  return (
    <dl
      className={
        layout === 'wide'
          ? 'grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-xs'
          : 'grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 text-xs'
      }
    >
      <Row label="Prompt">
        <p className="whitespace-pre-wrap text-text-primary">{task.prompt}</p>
      </Row>
      <Row label="Runs">
        <TargetLine task={task} />
      </Row>
      <Row label="When">
        <ScheduledTaskScheduleLine task={task} now={now} />
      </Row>
      <Row label="Last run">
        <ScheduledTaskLastRunLine task={task} />
      </Row>
      <Row label="Notifies on">{NOTIFICATION_POLICY_LABELS[task.notificationPolicy]}</Row>
      <Row label="Created by">
        {task.creator.label} · {String(task.runCount)} runs
      </Row>
    </dl>
  )
}

/**
 * One task's settings, actions and run history. The Right panel and Settings show the same view;
 * the container owns the way back.
 */
export function ScheduledTaskDetail({
  taskId,
  layout,
  onEdit,
  onDeleted,
}: {
  readonly taskId: string
  readonly layout: ScheduledTaskEditorLayout
  readonly onEdit: (task: ScheduledTask) => void
  readonly onDeleted: () => void
}) {
  const taskQuery = useQuery(scheduledTaskDetailQueryOptions(taskId))
  const task = taskQuery.data
  if (taskQuery.isError) {
    return (
      <p role="alert" className="p-4 text-sm text-error-text">
        {taskQuery.error.message}
      </p>
    )
  }
  if (!task) return null
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-2">
        <div className="pt-0.5">
          <ScheduledTaskKindIcon task={task} />
        </div>
        <div className="min-w-0 flex-1">
          {/* The Right panel header already names the task; Settings has no such header. */}
          {layout === 'wide' ? (
            <h2 className="truncate text-sm font-semibold text-text-primary">{task.name}</h2>
          ) : null}
          <p className="text-xs text-text-tertiary">{SCHEDULED_TASK_KIND_LABELS[task.kind]}</p>
        </div>
        {layout === 'wide' ? (
          <ScheduledTaskActions task={task} onEdit={onEdit} onDeleted={onDeleted} />
        ) : null}
      </div>
      {layout === 'narrow' ? (
        <ScheduledTaskActions task={task} onEdit={onEdit} onDeleted={onDeleted} align="start" />
      ) : null}
      <ScheduledTaskAttention task={task} />
      <TaskSettings task={task} layout={layout} />
      <ScheduledTaskRunHistory taskId={task.id} timeZone={differingTimeZone(task)} />
    </div>
  )
}
