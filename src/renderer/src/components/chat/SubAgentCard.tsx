import type { OrchestrationTaskStatus } from '@shared/types/orchestration'
import { choose, Rule } from '@shared/utils/decision'
import { AlertCircle, Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

interface SubAgentCardProps {
  taskId: string
  title: string
  status: OrchestrationTaskStatus
  output?: string
  error?: string
}

function getStatusIcon(status: OrchestrationTaskStatus): React.JSX.Element {
  return choose(status)
    .case('queued', () => (
      <div className="h-3.5 w-3.5 rounded-full border-2 border-border-light shrink-0" />
    ))
    .case(Rule.either('running' as const, 'retrying' as const), () => (
      <Loader2 className="h-3.5 w-3.5 text-accent animate-spin shrink-0" />
    ))
    .case('completed', () => <Check className="h-3.5 w-3.5 text-success shrink-0" />)
    .case('failed', () => <X className="h-3.5 w-3.5 text-error/80 shrink-0" />)
    .case('cancelled', () => <AlertCircle className="h-3.5 w-3.5 text-text-muted shrink-0" />)
    .assertComplete()
}

function getStatusLabel(status: OrchestrationTaskStatus): string {
  return choose(status)
    .case('queued', () => 'Queued')
    .case('running', () => 'Running')
    .case('retrying', () => 'Retrying')
    .case('completed', () => 'Completed')
    .case('failed', () => 'Failed')
    .case('cancelled', () => 'Cancelled')
    .assertComplete()
}

export function SubAgentCard({
  title,
  status,
  output,
  error,
}: SubAgentCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const hasContent = !!output || !!error
  const isTerminal = status === 'completed' || status === 'failed' || status === 'cancelled'

  return (
    <div className="group/sub">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => hasContent && setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-2 py-1 text-[13px] transition-colors',
          hasContent && 'cursor-pointer',
          !hasContent && 'cursor-default',
        )}
      >
        {getStatusIcon(status)}

        <span
          className={cn(
            'truncate',
            status === 'running' && 'text-text-secondary',
            status === 'queued' && 'text-text-muted',
            status === 'completed' && 'text-text-muted',
            status === 'failed' && 'text-error/80',
            status === 'cancelled' && 'text-text-muted',
            status === 'retrying' && 'text-warning',
          )}
        >
          {title}
        </span>

        {!isTerminal && (
          <span className="text-[11px] text-text-muted shrink-0">{getStatusLabel(status)}</span>
        )}

        {hasContent && (
          <ChevronRight
            className={cn(
              'ml-auto h-3 w-3 text-text-muted shrink-0 transition-transform',
              'invisible group-hover/sub:visible',
              expanded && 'visible rotate-90',
            )}
          />
        )}
      </button>

      {expanded && hasContent && (
        <div className="ml-5 mt-1 mb-1 rounded-md border border-border bg-bg-secondary/50 overflow-hidden">
          {error && (
            <div className="px-3 py-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3.5 w-3.5 text-error shrink-0 mt-0.5" />
                <pre className="text-[13px] font-mono text-error whitespace-pre-wrap break-words flex-1">
                  {error}
                </pre>
              </div>
            </div>
          )}
          {output && !error && (
            <div className="px-3 py-2">
              <pre className="text-[13px] font-mono text-text-secondary whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
