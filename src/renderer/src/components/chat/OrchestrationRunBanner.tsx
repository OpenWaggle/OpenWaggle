import type { OrchestrationEventPayload, OrchestrationRunRecord } from '@shared/types/orchestration'

interface OrchestrationRunBannerProps {
  run: OrchestrationRunRecord
  events: readonly OrchestrationEventPayload[]
  lastUserMessage: string | null
  onCancelOrchestrationRun?: (runId: string) => Promise<void> | void
  onRetry?: (content: string) => void
}

export function OrchestrationRunBanner({
  run,
  events,
  lastUserMessage,
  onCancelOrchestrationRun,
  onRetry,
}: OrchestrationRunBannerProps): React.JSX.Element {
  return (
    <div className="rounded-xl border border-border-light bg-bg-secondary/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-text-muted">Agent Orchestration</div>
          <div className="text-sm text-text-secondary">
            Run {String(run.runId)} · {run.status}
            {run.fallbackUsed ? ' · fallback' : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {run.status === 'running' && onCancelOrchestrationRun && (
            <button
              type="button"
              onClick={() => onCancelOrchestrationRun(String(run.runId))}
              className="rounded-md border border-error/40 px-2 py-1 text-xs text-error hover:bg-error/10"
            >
              Cancel
            </button>
          )}
          {(run.status === 'failed' || run.status === 'cancelled') &&
            lastUserMessage &&
            onRetry && (
              <button
                type="button"
                onClick={() => onRetry(lastUserMessage)}
                className="rounded-md border border-border-light px-2 py-1 text-xs text-text-secondary hover:bg-bg-hover"
              >
                Retry
              </button>
            )}
        </div>
      </div>
      {events.length > 0 && (
        <div className="mt-2 space-y-1">
          {events.map((event) => (
            <div
              key={`${event.runId}-${event.type}-${event.at}-${event.taskId ?? ''}`}
              className="text-xs text-text-tertiary"
            >
              {event.type}
              {event.taskId ? ` · ${String(event.taskId)}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
