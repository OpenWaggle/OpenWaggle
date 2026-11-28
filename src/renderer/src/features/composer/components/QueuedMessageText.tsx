import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

/**
 * The first line, ending in an ellipsis when more lines follow it. Its closing `.`, `,`, `;` or
 * `:` goes, so "Fix the tests." reads "Fix the tests…" rather than four dots.
 */
function firstLineOf(text: string) {
  const [first = '', ...rest] = text.trim().split('\n')
  return rest.length > 0 ? `${first.trim().replace(/[.,;:]+$/u, '')}…` : first.trim()
}

interface QueuedMessageTextProps {
  readonly text: string
  readonly expanded: boolean
  readonly onToggle: () => void
}

/**
 * A queued message's text, one line until opened. A long prompt shown in full pushed the
 * conversation out of view, so a closed row shows its first line, and an open one scrolls past
 * twelve lines (`max-h-54` is twelve `text-xs` `leading-normal` lines). A first line that
 * overflows ends in the CSS ellipsis, and one with more lines after it ends in its own.
 * The button keeps the same text open or closed: `aria-expanded` carries the state, and a
 * constant name still says which message it opens.
 */
export function QueuedMessageText({ text, expanded, onToggle }: QueuedMessageTextProps) {
  const bodyId = useId()
  const firstLine = firstLineOf(text)

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
        <span className="min-w-0 flex-1 truncate">{firstLine}</span>
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
