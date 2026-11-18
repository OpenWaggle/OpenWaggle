import type { ScheduledTask } from '@shared/types/scheduled-task'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useSessionProjectPath } from '@/features/sessions/hooks'
import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { hasRightPanelController, showRightPanelSurface } from '@/shared/lib/right-panel-surfaces'
import {
  type ScheduledTasksView,
  showScheduledTasksView,
} from '../state/scheduled-tasks-navigation-store'

function isChatPath(pathname: string) {
  return pathname === '/' || pathname.startsWith('/sessions/')
}

/**
 * Opens a Scheduled tasks view where the user is: the Right panel's Scheduled surface when a
 * chat for the task's project is open, otherwise Settings › Scheduled tasks (CONTEXT.md).
 */
export function useShowScheduledTasks() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const router = useRouter()
  const sessionProjectPath = useSessionProjectPath()

  /** The task's project; undefined when the list does not know the task yet. */
  const taskProject = (taskId: string) =>
    queryClient
      .getQueryData<readonly ScheduledTask[]>(scheduledTasksListQueryOptions().queryKey)
      ?.find((task) => task.id === taskId)?.projectPath

  return (view: ScheduledTasksView) => {
    const projectPath =
      view.kind === 'task' || view.kind === 'edit'
        ? taskProject(view.taskId)
        : view.kind === 'new'
          ? (view.defaults.projectPath ?? sessionProjectPath)
          : sessionProjectPath
    // A task the list does not know yet, or one with no project, opens in Settings, which lists
    // every task; the panel would only fall back to its own project's list.
    const inPanel =
      isChatPath(router.state.location.pathname) &&
      hasRightPanelController() &&
      sessionProjectPath !== null &&
      projectPath === sessionProjectPath
    if (inPanel) {
      showScheduledTasksView('panel', view)
      showRightPanelSurface('scheduled-tasks')
      return
    }
    showScheduledTasksView('settings', view)
    void navigate({ to: '/settings/$tab', params: { tab: 'scheduled' } })
  }
}

/** Opens Settings › Scheduled tasks, every project, on `view`. */
export function useOpenScheduledTasksSettings() {
  const navigate = useNavigate()
  return (view: ScheduledTasksView = { kind: 'list' }) => {
    showScheduledTasksView('settings', view)
    void navigate({ to: '/settings/$tab', params: { tab: 'scheduled' } })
  }
}

/** Opens one task's detail and history where the user is. */
export function useOpenScheduledTask() {
  const show = useShowScheduledTasks()
  return (taskId: string) => show({ kind: 'task', taskId })
}
