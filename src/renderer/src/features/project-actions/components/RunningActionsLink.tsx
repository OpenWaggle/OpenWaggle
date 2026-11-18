import type { ActionManagementScope } from '@shared/types/action-management'
import type { ActionRun } from '@shared/types/action-runs'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { openWorkspaceAction } from '@/shell/workspace-panel-actions'
export function RunningActionsLink({
  scope,
  runs,
}: {
  readonly scope: ActionManagementScope
  readonly runs: readonly ActionRun[]
}) {
  const navigate = useNavigate()
  const first = runs[0]
  const sessionId = scope.sessionId
  if (!first || !sessionId) return null
  return (
    <Button
      variant="row"
      className="justify-between rounded-lg border border-border px-4 py-3"
      onClick={() => {
        openWorkspaceAction(sessionId, scope.projectPath, first.id)
        void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
      }}
    >
      <span className="text-sm">
        {runs.length} {runs.length === 1 ? 'action running' : 'actions running'} in this workspace
      </span>
      <span className="flex items-center gap-2 text-xs text-accent">
        View in session
        <ArrowRight className="size-3.5" />
      </span>
    </Button>
  )
}
