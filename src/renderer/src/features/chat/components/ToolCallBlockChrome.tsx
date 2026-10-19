import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ToolCallResultPayload } from '@/features/chat/lib/tool-call-block'
import { cn } from '@/shared/lib/cn'
import { formatDuration } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { useChatDisplayText } from './ChatDisplayPathContext'
import { DiffStatLabel, describeDiffStat } from './DiffStatLabel'
import type { ToolCallViewModel } from './ToolCallBlock'
import {
  ToolRowFailureMark,
  ToolRowIcon,
  type ToolRowStatus,
  toolRowLabelClassName,
} from './ToolRowStatus'

interface ToolCallHeaderProps {
  readonly expanded: boolean
  readonly duration: number
  readonly result: ToolCallResultPayload | undefined
  readonly view: ToolCallViewModel
  readonly onToggleExpanded: () => void
  /** Controls of the row's subject that sit outside its toggle, such as a Worker's Open. */
  readonly addon?: ReactNode
}

export function ToolCallHeader({
  expanded,
  duration,
  result,
  view,
  onToggleExpanded,
  addon,
}: ToolCallHeaderProps) {
  const actionText = useChatDisplayText(view.actionText)
  const status = toolRowStatus(view, result)
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="unstyled"
        type="button"
        aria-expanded={expanded}
        aria-label={toolHeaderLabel(actionText, view, status, expanded)}
        onClick={onToggleExpanded}
        className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-sm transition-colors"
      >
        <ToolRowIcon kind={view.kind} status={status} />
        <span className={cn('truncate', toolRowLabelClassName(status))}>{actionText}</span>
        {status === 'failed' && <ToolRowFailureMark />}
        <ToolDiffSummary view={view} />
        {duration > 0 && !view.isRunning && (
          <span className="text-xs text-text-muted shrink-0">{formatDuration(duration)}</span>
        )}
        <ChevronRight
          className={cn(
            'ml-auto size-3 text-text-muted shrink-0 transition-transform',
            'invisible group-hover/tool:visible',
            expanded && 'visible rotate-90',
          )}
        />
      </Button>
      {addon}
    </div>
  )
}

/**
 * The toggle's label replaces its content, so it uses the same display text the row
 * shows (label in name) and carries the diff stat and the failure itself.
 */
function toolHeaderLabel(
  actionText: string,
  view: ToolCallViewModel,
  status: ToolRowStatus,
  expanded: boolean,
) {
  const stat = view.diff ? `, ${describeDiffStat(view.diff)}` : ''
  const failed = status === 'failed' ? ', failed' : ''
  return `${actionText}${failed}${stat} — ${expanded ? 'collapse' : 'expand'} details`
}

/** Running wins over a failure a streaming call already reported, as the old spinner did. */
function toolRowStatus(
  view: ToolCallViewModel,
  result: ToolCallResultPayload | undefined,
): ToolRowStatus {
  if (view.isRunning) return 'running'
  if (result && view.isError) return 'failed'
  if (view.hasConcreteResult && result) return 'done'
  return 'requested'
}

function ToolDiffSummary({ view }: { readonly view: ToolCallViewModel }) {
  if (!view.diff) {
    return null
  }
  return (
    <span className="shrink-0 text-xs">
      <DiffStatLabel
        additions={view.diff.additions}
        deletions={view.diff.deletions}
        layout="inline"
      />
    </span>
  )
}

export function CollapsedToolPreview({
  view,
  expanded,
}: {
  readonly view: ToolCallViewModel
  readonly expanded: boolean
}) {
  if (expanded) {
    return null
  }
  return (
    <>
      {view.liveOutputPreview && <ToolPreview text={view.liveOutputPreview} tone="muted" />}
      {view.failedOutputPreview && <ToolPreview text={view.failedOutputPreview} tone="error" />}
    </>
  )
}

function ToolPreview({ text, tone }: { readonly text: string; readonly tone: 'muted' | 'error' }) {
  const displayText = useChatDisplayText(text)
  return (
    <PlainTextBlock
      reason={tone === 'error' ? 'error' : 'log'}
      className={cn(
        'ml-5 mt-1 overflow-hidden rounded-md px-3 py-2 text-xs font-mono whitespace-pre-wrap break-words',
        tone === 'error'
          ? 'max-h-40 border border-error/20 bg-error/5 text-error'
          : 'max-h-30 bg-bg-secondary/60 text-text-tertiary',
      )}
    >
      {displayText}
    </PlainTextBlock>
  )
}
