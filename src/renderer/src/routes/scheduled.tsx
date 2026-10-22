import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useNavigateBackToApp } from '@/features/chat/hooks'
import { ScheduledTasksPage } from '@/features/scheduled-tasks'

export interface ScheduledRouteSearch {
  /** The task whose detail and history are open. */
  readonly task?: string
}

function parseScheduledRouteSearch(search: Record<string, unknown>): ScheduledRouteSearch {
  const task = search.task
  return typeof task === 'string' && task.trim() !== '' ? { task } : {}
}

export const Route = createFileRoute('/scheduled')({
  validateSearch: parseScheduledRouteSearch,
  component: ScheduledTasksRouteView,
})

function ScheduledTasksRouteView() {
  const { task } = Route.useSearch()
  const navigate = useNavigate()
  const navigateBackToApp = useNavigateBackToApp()
  return (
    <ScheduledTasksPage
      selectedTaskId={task ?? null}
      onSelectTask={(taskId) =>
        void navigate({ to: '/scheduled', search: taskId ? { task: taskId } : {} })
      }
      onBack={navigateBackToApp}
    />
  )
}
