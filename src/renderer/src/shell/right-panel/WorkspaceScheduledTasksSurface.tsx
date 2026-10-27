import { ScheduledTasksPanel } from '@/features/scheduled-tasks/components'
import { useScheduledTasksPanelScope } from './scheduled-tasks-panel-scope'

/** Hosts the Scheduled surface for the open Session's project (ADR 0057). */
export function WorkspaceScheduledTasksSurface() {
  const scope = useScheduledTasksPanelScope()
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <ScheduledTasksPanel sessionId={scope.sessionId} projectPath={scope.projectPath} />
    </div>
  )
}
