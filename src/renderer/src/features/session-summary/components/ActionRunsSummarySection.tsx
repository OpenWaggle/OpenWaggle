import { isActiveActionRun } from '@shared/types/action-runs'
import { Activity, CheckCircle2, CircleAlert } from 'lucide-react'
import { useState } from 'react'
import { actionRunLabel, useActionRuns } from '@/features/project-actions'
import { openWorkspaceAction } from '@/shell/workspace-panel-actions'
import { SessionSummaryRow, SessionSummarySection } from './SessionSummaryPrimitives'

const RECENT_RUNS = 4
export function ActionRunsSummarySection({
  sessionId,
  projectPath,
}: {
  readonly sessionId: string
  readonly projectPath: string | null
}) {
  const [expanded, setExpanded] = useState(true)
  const query = useActionRuns(projectPath ? { projectPath, sessionId } : null)
  const runs = query.data ?? []
  const active = runs.filter(isActiveActionRun)
  const recent = runs.filter((run) => !isActiveActionRun(run)).slice(0, RECENT_RUNS)
  if (!projectPath || (!query.isError && runs.length === 0)) return null
  return (
    <SessionSummarySection
      id="actions"
      title="Actions"
      count={active.length || runs.length}
      expanded={expanded}
      onExpandedChange={setExpanded}
    >
      {query.isError ? (
        <p role="status" className="px-3 py-2 text-xs text-text-tertiary">
          Reconnecting to actions…
        </p>
      ) : null}
      {[...active, ...recent].map((run) => (
        <SessionSummaryRow
          key={run.id}
          icon={
            isActiveActionRun(run) ? (
              <Activity className="size-4 text-accent" />
            ) : run.status === 'completed' ? (
              <CheckCircle2 className="size-4 text-success" />
            ) : (
              <CircleAlert className="size-4 text-text-tertiary" />
            )
          }
          label={run.action.name}
          value={<span className="text-xs">{actionRunLabel(run)}</span>}
          onClick={() => openWorkspaceAction(sessionId, projectPath, run.id)}
        />
      ))}
    </SessionSummarySection>
  )
}
