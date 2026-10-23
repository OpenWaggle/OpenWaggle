import { shownScheduledTasksView } from '../lib/scheduled-tasks-view'
import { useScheduledTaskIndexStore } from '../state/scheduled-task-index-store'
import {
  showScheduledTasksView,
  useScheduledTasksNavigationStore,
} from '../state/scheduled-tasks-navigation-store'

const PANEL_LABEL = 'Scheduled'

export interface ScheduledTasksPanelTitle {
  readonly label: string
  readonly backLabel?: string
  readonly onBack?: () => void
}

/**
 * The Right panel header for the Scheduled surface, with its way back to the list or task. It
 * resolves the view for the same Session and project as the panel body, so a deleted task or one
 * from the previous Session's project shows the list title, as the body shows the list.
 */
export function useScheduledTasksPanelTitle(scope: {
  readonly projectPath: string | null
  readonly sessionId: string | null
}): ScheduledTasksPanelTitle {
  const storedView = useScheduledTasksNavigationStore((state) => state.panel)
  const names = useScheduledTaskIndexStore((state) => state.names)
  const projects = useScheduledTaskIndexStore((state) => state.projects)
  const view = shownScheduledTasksView(storedView, projects, scope)
  const nameOf = (taskId: string) => names[taskId] ?? 'Scheduled task'
  const toList = () => showScheduledTasksView('panel', { kind: 'list' })
  if (view.kind === 'list') return { label: PANEL_LABEL }
  if (view.kind === 'new') return { label: 'New task', backLabel: PANEL_LABEL, onBack: toList }
  if (view.kind === 'task') {
    return { label: nameOf(view.taskId), backLabel: PANEL_LABEL, onBack: toList }
  }
  const name = nameOf(view.taskId)
  return {
    label: `Edit ${name}`,
    backLabel: name,
    onBack: () => showScheduledTasksView('panel', { kind: 'task', taskId: view.taskId }),
  }
}
