import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { useOpenScheduledTasksSettings } from '../hooks/useShowScheduledTasks'
import { scheduledTaskProjects, shownScheduledTasksView } from '../lib/scheduled-tasks-view'
import {
  showScheduledTasksView,
  useScheduledTasksNavigationStore,
} from '../state/scheduled-tasks-navigation-store'
import { BackgroundStartOffer } from './BackgroundStartOffer'
import { type ScheduledTaskRowGroup, ScheduledTaskRows } from './ScheduledTaskRows'
import { ScheduledTasksViewBody } from './ScheduledTasksViewBody'

function panelGroups(
  tasks: readonly ScheduledTask[],
  scope: { readonly sessionId: string | null; readonly projectPath: string },
): readonly ScheduledTaskRowGroup[] {
  const inProject = tasks.filter((task) => task.projectPath === scope.projectPath)
  const intoSession = (task: ScheduledTask) =>
    task.target.kind === 'heartbeat' && task.target.sessionId === scope.sessionId
  const project = projectName(scope.projectPath)
  const groups: ScheduledTaskRowGroup[] = []
  if (scope.sessionId !== null) {
    groups.push({
      id: 'session',
      label: 'Into this Session',
      tasks: inProject.filter(intoSession),
      emptyText: 'No Heartbeat runs in this Session.',
    })
  }
  groups.push({
    id: 'launch',
    label: `Launch schedules in ${project}`,
    title: scope.projectPath,
    tasks: inProject.filter((task) => task.kind === 'launch'),
  })
  const otherHeartbeats = inProject.filter(
    (task) => task.kind === 'heartbeat' && !intoSession(task),
  )
  if (otherHeartbeats.length > 0) {
    groups.push({
      id: 'heartbeats',
      label: `Other Heartbeats in ${project}`,
      tasks: otherHeartbeats,
    })
  }
  return groups
}

function PanelList({
  sessionId,
  projectPath,
}: {
  readonly sessionId: string | null
  readonly projectPath: string
}) {
  const tasksQuery = useQuery(scheduledTasksListQueryOptions())
  const openSettings = useOpenScheduledTasksSettings()
  const create = () =>
    showScheduledTasksView('panel', {
      kind: 'new',
      defaults: sessionId ? { kind: 'heartbeat', sessionId } : { kind: 'launch', projectPath },
    })
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <p className="min-w-0 truncate text-xs text-text-tertiary" title={projectPath}>
          Tasks in {projectName(projectPath)}
        </p>
        <Button
          variant="secondary"
          size="xs"
          leftIcon={<Plus className="size-3" />}
          onClick={create}
        >
          New task
        </Button>
      </div>
      <BackgroundStartOffer />
      {tasksQuery.isError ? (
        <p role="alert" className="px-2 text-xs text-error-text">
          Scheduled tasks could not be loaded: {tasksQuery.error.message}
        </p>
      ) : null}
      {tasksQuery.data ? (
        <ScheduledTaskRows
          groups={panelGroups(tasksQuery.data, { sessionId, projectPath })}
          selectedTaskId={null}
          onSelect={(taskId) => showScheduledTasksView('panel', { kind: 'task', taskId })}
        />
      ) : null}
      <p className="px-2 pt-2 text-xs text-text-muted">
        Tasks in other projects are in{' '}
        <Button variant="link" size="none" onClick={() => openSettings()}>
          Settings › Scheduled tasks
        </Button>
      </p>
    </div>
  )
}

/**
 * The Right panel's Scheduled surface: the tasks of the project the user is in, Heartbeats into
 * this Session first. Opening a task or New replaces the list in place (CONTEXT.md).
 */
export function ScheduledTasksPanel({
  sessionId,
  projectPath,
}: {
  readonly sessionId: string | null
  readonly projectPath: string | null
}) {
  const storedView = useScheduledTasksNavigationStore((state) => state.panel)
  const { data: tasks } = useQuery(scheduledTasksListQueryOptions())
  const view = shownScheduledTasksView(storedView, tasks && scheduledTaskProjects(tasks), {
    projectPath,
    sessionId,
  })
  if (projectPath === null) {
    return <p className="p-4 text-xs text-text-tertiary">Open a project to see its tasks.</p>
  }
  if (view.kind === 'list') return <PanelList sessionId={sessionId} projectPath={projectPath} />
  return <ScheduledTasksViewBody container="panel" view={view} layout="narrow" />
}
