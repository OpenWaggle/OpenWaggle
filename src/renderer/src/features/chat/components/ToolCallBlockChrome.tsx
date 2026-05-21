import { Check, ChevronRight, GitBranch, Loader2, X } from 'lucide-react'
import type { ToolCallResultPayload } from '@/features/chat/lib/tool-call-block'
import { cn } from '@/shared/lib/cn'
import { formatDuration } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import type { ToolCallViewModel } from './ToolCallBlock'
import { UnifiedDiffView } from './ToolCallBlockParts'

interface ToolCallHeaderProps {
  readonly expanded: boolean
  readonly duration: number
  readonly result: ToolCallResultPayload | undefined
  readonly view: ToolCallViewModel
  readonly onBranchFromMessage?: (messageId: string) => void
  readonly onToggleExpanded: () => void
}

export function ToolCallHeader({
  expanded,
  duration,
  result,
  view,
  onBranchFromMessage,
  onToggleExpanded,
}: ToolCallHeaderProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="unstyled"
        type="button"
        aria-expanded={expanded}
        aria-label={`${view.actionText} — ${expanded ? 'collapse' : 'expand'} details`}
        onClick={onToggleExpanded}
        className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-[13px] transition-colors"
      >
        <ToolStatusIcon view={view} result={result} />
        <ToolActionLabel view={view} result={result} />
        <ToolDiffSummary view={view} />
        {duration > 0 && !view.isRunning && (
          <span className="text-[12px] text-text-muted shrink-0">{formatDuration(duration)}</span>
        )}
        <ChevronRight
          className={cn(
            'ml-auto size-3 text-text-muted shrink-0 transition-transform',
            'invisible group-hover/tool:visible',
            expanded && 'visible rotate-90',
          )}
        />
      </Button>
      <BranchFromToolButton view={view} onBranchFromMessage={onBranchFromMessage} />
    </div>
  )
}

function ToolStatusIcon({
  view,
  result,
}: {
  readonly view: ToolCallViewModel
  readonly result: ToolCallResultPayload | undefined
}) {
  if (view.isRunning) {
    return (
      <Loader2
        role="status"
        aria-label="Running"
        className="size-3.5 text-text-tertiary animate-spin shrink-0"
      />
    )
  }
  if (view.hasConcreteResult && result && !view.isError) {
    return <Check className="size-3.5 text-text-muted shrink-0" />
  }
  if (result && view.isError) {
    return <X className="size-3.5 text-error/80 shrink-0" />
  }
  return null
}

function ToolActionLabel({
  view,
  result,
}: {
  readonly view: ToolCallViewModel
  readonly result: ToolCallResultPayload | undefined
}) {
  return (
    <span
      className={cn(
        'truncate',
        view.isRunning && 'text-text-tertiary',
        view.hasConcreteResult && result && !view.isError && 'text-text-muted',
        result && view.isError && 'text-error/80',
      )}
    >
      {view.actionText}
    </span>
  )
}

function ToolDiffSummary({ view }: { readonly view: ToolCallViewModel }) {
  if (!view.diff) {
    return null
  }
  return (
    <span className="flex items-center gap-1 text-[12px] shrink-0">
      <span className="text-success">+{view.diff.additions}</span>
      <span className="text-error">-{view.diff.deletions}</span>
    </span>
  )
}

function BranchFromToolButton({
  view,
  onBranchFromMessage,
}: {
  readonly view: ToolCallViewModel
  readonly onBranchFromMessage?: (messageId: string) => void
}) {
  if (!view.branchSourceMessageId || !onBranchFromMessage) {
    return null
  }
  return (
    <Button
      variant="unstyled"
      type="button"
      title="Branch from tool result"
      onClick={() => onBranchFromMessage(view.branchSourceMessageId ?? '')}
      className="opacity-0 text-text-muted transition-opacity hover:text-text-secondary group-hover/tool:opacity-100 focus:opacity-100"
    >
      <GitBranch className="size-3.5" />
    </Button>
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
      {view.inlineDiffVisible && view.diff && (
        <div className="ml-5 mt-1">
          <UnifiedDiffView diff={view.diff} compact />
        </div>
      )}
      {view.liveOutputPreview && <ToolPreview text={view.liveOutputPreview} tone="muted" />}
      {view.failedOutputPreview && <ToolPreview text={view.failedOutputPreview} tone="error" />}
    </>
  )
}

function ToolPreview({ text, tone }: { readonly text: string; readonly tone: 'muted' | 'error' }) {
  return (
    <pre
      className={cn(
        'ml-5 mt-1 overflow-hidden rounded-md px-3 py-2 text-[12px] font-mono whitespace-pre-wrap break-words',
        tone === 'error'
          ? 'max-h-[160px] border border-error/20 bg-error/5 text-error'
          : 'max-h-[120px] bg-bg-secondary/60 text-text-tertiary',
      )}
    >
      {text}
    </pre>
  )
}
