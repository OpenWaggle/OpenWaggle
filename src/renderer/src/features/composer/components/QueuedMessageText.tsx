import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

function messageLines(text: string) {
  return text.trim().split('\n')
}

function lineCountLabel(count: number) {
  return count === 1 ? '1 line' : `${String(count)} lines`
}

interface QueuedMessageTextProps {
  readonly text: string
  readonly expanded: boolean
  readonly onToggle: () => void
}

/**
 * A queued message's text, one line until opened. A long prompt shown in full pushed the
 * conversation out of view, so a closed row shows its first line and how many lines it has, and
 * an open one scrolls past twelve lines (`max-h-54` is twelve `text-xs` `leading-normal` lines).
 */
export function QueuedMessageText({ text, expanded, onToggle }: QueuedMessageTextProps) {
  const bodyId = useId()
  const lines = messageLines(text)
  const firstLine = lines[0]?.trim() ?? ''
  const countLabel = lines.length > 1 ? lineCountLabel(lines.length) : null

  return (
    <>
      <Button
        variant="unstyled"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? bodyId : undefined}
        className="flex min-w-0 items-center gap-1.5 rounded-sm text-left text-xs leading-normal text-text-muted hover:text-text-primary"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-3 shrink-0 text-text-tertiary transition-transform',
            expanded && 'rotate-90',
          )}
        />
        {expanded ? (
          <span className="min-w-0 flex-1 truncate text-text-tertiary">
            Collapse{countLabel ? ` · ${countLabel}` : ''}
          </span>
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{firstLine}</span>
            {/* The space separates the two in the button's name; flex layout drops it visually. */}
            {countLabel ? ' ' : null}
            {countLabel ? <span className="shrink-0 text-text-tertiary">{countLabel}</span> : null}
          </>
        )}
      </Button>
      {expanded ? (
        <div
          id={bodyId}
          data-qa="queued-message-text"
          className="max-h-54 overflow-y-auto whitespace-pre-wrap wrap-break-word text-xs leading-normal text-text-muted"
        >
          {text}
        </div>
      ) : null}
    </>
  )
}
