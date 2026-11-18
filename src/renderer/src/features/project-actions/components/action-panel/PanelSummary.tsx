import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

const TALL_PANEL_QUERY = '(min-height: 860px)'

interface SummaryText {
  readonly before?: string
  readonly command: string
  readonly after?: string
}

/**
 * The pinned "what will happen" summary (ADR 0038): one line that updates live, expanding to the
 * full sentence. It starts expanded when the panel is tall enough to afford it.
 */
export function PanelSummary(props: {
  readonly line: SummaryText
  readonly sentence: SummaryText
}) {
  const [expanded, setExpanded] = useState(
    () =>
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia(TALL_PANEL_QUERY).matches,
  )
  const text = expanded ? props.sentence : props.line
  return (
    <Button
      variant="unstyled"
      aria-expanded={expanded}
      className="flex w-full items-start gap-2 rounded-lg bg-bg-tertiary px-3.5 py-2.5 text-left text-sm leading-6 text-text-secondary"
      onClick={() => setExpanded(!expanded)}
    >
      <span className={cn('min-w-0 flex-1', !expanded && 'truncate')}>
        {text.before}
        <code className="font-mono text-text-primary">{text.command}</code>
        {text.after}
        <span className="sr-only">{expanded ? ' Show one line.' : ' Show the full summary.'}</span>
      </span>
      <ChevronDown
        aria-hidden
        className={cn(
          'mt-1 size-4 shrink-0 text-text-tertiary transition-transform',
          expanded && 'rotate-180',
        )}
      />
    </Button>
  )
}
