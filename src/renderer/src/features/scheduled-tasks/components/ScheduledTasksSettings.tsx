import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, Plus } from 'lucide-react'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { scheduledTaskProjects, shownScheduledTasksView } from '../lib/scheduled-tasks-view'
import { groupTasksByProject } from '../lib/task-groups'
import {
  type ScheduledTasksView,
  showScheduledTasksView,
  useScheduledTasksNavigationStore,
} from '../state/scheduled-tasks-navigation-store'
import { BackgroundStartSetting } from './BackgroundStartSetting'
import { ScheduledTaskRows } from './ScheduledTaskRows'
import { ScheduledTasksViewBody } from './ScheduledTasksViewBody'

const ALL_PROJECTS = ''

function show(view: ScheduledTasksView) {
  showScheduledTasksView('settings', view)
}

function selectedTaskId(view: ScheduledTasksView) {
  return view.kind === 'task' || view.kind === 'edit' ? view.taskId : null
}

function Header({
  tasks,
  project,
  onProjectChange,
}: {
  readonly tasks: readonly ScheduledTask[]
  readonly project: string
  readonly onProjectChange: (project: string) => void
}) {
  const groups = groupTasksByProject(tasks)
  const openProjectPath = usePreferencesStore((state) => state.settings.projectPath)
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-text-primary">Scheduled tasks</h2>
        <p className="text-xs text-text-tertiary">
          Prompts the Session Host sends on a schedule, in every project. Inside a Session, the
          Scheduled panel shows that project’s tasks.
        </p>
      </div>
      {groups.length > 1 ? (
        <Select
          aria-label="Project"
          value={project}
          onChange={(event) => onProjectChange(event.target.value)}
        >
          <option value={ALL_PROJECTS}>All projects</option>
          {groups.map((group) => (
            <option key={group.projectPath ?? 'none'} value={group.projectPath ?? ''}>
              {group.label}
            </option>
          ))}
        </Select>
      ) : null}
      <Button
        variant="primary"
        size="xs"
        leftIcon={<Plus className="size-3" />}
        onClick={() => {
          const projectPath = project === ALL_PROJECTS ? openProjectPath : project
          show({ kind: 'new', defaults: projectPath ? { projectPath } : {} })
        }}
      >
        New task
      </Button>
    </div>
  )
}

function EmptyDetail({ hasTasks }: { readonly hasTasks: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <CalendarClock aria-hidden="true" className="size-6 text-text-tertiary" />
      <p className="max-w-sm text-xs text-text-tertiary">
        {hasTasks
          ? 'Choose a task to see its settings and history.'
          : 'No Scheduled tasks yet. A Heartbeat sends a prompt into one Session on a schedule; a Launch schedule starts a new Session each time it fires.'}
      </p>
    </div>
  )
}

/** Settings › Scheduled tasks: every task in every project, as a list and one task’s detail. */
export function ScheduledTasksSettings() {
  const tasksQuery = useQuery(scheduledTasksListQueryOptions())
  const storedView = useScheduledTasksNavigationStore((state) => state.settings)
  const [project, setProject] = useState(ALL_PROJECTS)
  const tasks = tasksQuery.data ?? []
  const view = shownScheduledTasksView(
    storedView,
    tasksQuery.data && scheduledTaskProjects(tasksQuery.data),
    null,
  )
  const visible =
    project === ALL_PROJECTS ? tasks : tasks.filter((task) => task.projectPath === project)
  const groups = groupTasksByProject(visible).map((group) => ({
    id: group.projectPath ?? 'none',
    label: group.label,
    title: group.projectPath ?? undefined,
    tasks: group.tasks,
  }))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header tasks={tasks} project={project} onProjectChange={setProject} />
      <BackgroundStartSetting />
      <div className="flex min-h-0 flex-1">
        <div className="w-72 shrink-0 overflow-y-auto border-r border-border p-2">
          {tasksQuery.isError ? (
            <p role="alert" className="px-2 text-xs text-error-text">
              Scheduled tasks could not be loaded: {tasksQuery.error.message}
            </p>
          ) : null}
          <ScheduledTaskRows
            groups={groups}
            selectedTaskId={selectedTaskId(view)}
            onSelect={(taskId) => show({ kind: 'task', taskId })}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {view.kind === 'list' ? (
            <EmptyDetail hasTasks={tasks.length > 0} />
          ) : (
            <ScheduledTasksViewBody container="settings" view={view} layout="wide" />
          )}
        </div>
      </div>
    </div>
  )
}
