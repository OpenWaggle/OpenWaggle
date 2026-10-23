import type { ScheduledTaskRun } from '@shared/types/scheduled-task'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { scheduledTaskRunsQueryOptions } from '@/queries/scheduled-tasks'
import { Button } from '@/shared/ui/Button'
import { useOpenScheduledSession } from '../hooks/useOpenScheduledSession'
import { formatAbsoluteTime, RUN_TRIGGER_LABELS, runReasonText } from '../lib/task-format'
import { ScheduledTaskRunStatus } from './ScheduledTaskParts'

function triggerText(run: ScheduledTaskRun) {
  const label = RUN_TRIGGER_LABELS[run.trigger]
  if (run.trigger !== 'catch-up' || run.missedCount <= 1) return label
  return `${label} (${String(run.missedCount)} missed)`
}

function RunRow({
  run,
  timeZone,
  onOpenSession,
}: {
  readonly run: ScheduledTaskRun
  readonly timeZone: string | null
  readonly onOpenSession: (sessionId: string) => void
}) {
  const reason = runReasonText(run)
  const showNominal = run.trigger !== 'run-now' && run.nominalAt !== run.firedAt
  return (
    <li className="flex items-start gap-3 border-b border-border px-3 py-2 text-xs last:border-b-0">
      <div className="w-14 shrink-0 pt-px">
        <ScheduledTaskRunStatus run={run} />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-text-secondary">
          {formatAbsoluteTime(run.firedAt, timeZone)}
          <span className="text-text-tertiary"> · {triggerText(run)}</span>
        </div>
        {showNominal ? (
          <div className="text-text-muted">Due {formatAbsoluteTime(run.nominalAt, timeZone)}</div>
        ) : null}
        {reason ? <div className="text-text-secondary">{reason}</div> : null}
      </div>
      {run.sessionId ? (
        <Button
          variant="ghost"
          size="xs"
          aria-label="Open Session"
          rightIcon={<ExternalLink className="size-3" />}
          onClick={() => {
            if (run.sessionId) onOpenSession(run.sessionId)
          }}
        >
          Open
        </Button>
      ) : null}
    </li>
  )
}

/** Every Scheduled task run, newest first: nominal beside actual time, and why any was skipped. */
export function ScheduledTaskRunHistory({
  taskId,
  timeZone,
}: {
  readonly taskId: string
  readonly timeZone: string | null
}) {
  const runsQuery = useQuery(scheduledTaskRunsQueryOptions(taskId))
  const openSession = useOpenScheduledSession()

  return (
    <section aria-label="Run history" className="space-y-2">
      <h2 className="text-xs font-medium text-text-tertiary">History</h2>
      {runsQuery.isError ? (
        <p role="alert" className="text-xs text-error-text">
          The history could not be loaded: {runsQuery.error.message}
        </p>
      ) : null}
      {runsQuery.data && runsQuery.data.length === 0 ? (
        <p className="rounded-lg border border-border bg-bg px-4 py-6 text-center text-xs text-text-tertiary">
          This task has not run yet.
        </p>
      ) : null}
      {runsQuery.data && runsQuery.data.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border bg-bg">
          {runsQuery.data.map((run) => (
            <RunRow key={run.id} run={run} timeZone={timeZone} onOpenSession={openSession} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
