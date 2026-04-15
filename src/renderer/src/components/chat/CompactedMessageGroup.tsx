import { ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/cn'

interface CompactedMessageGroupProps {
  readonly count: number
  readonly children: React.ReactNode
}

/**
 * Collapsible wrapper for compacted messages. Shows a compact summary bar
 * that expands to reveal the original messages when clicked.
 */
export function CompactedMessageGroup({ count, children }: CompactedMessageGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const regionId = useId()

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={regionId}
        className="flex w-full items-center gap-2 px-4 py-1.5 text-[11px] text-text-muted hover:text-text-secondary hover:bg-bg-hover/30 transition-colors"
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform duration-150', expanded && 'rotate-90')}
        />
        <span className="font-mono tabular-nums">{count}</span>
        <span>compacted message{count > 1 ? 's' : ''}</span>
      </button>
      {expanded && (
        <section id={regionId} aria-label="Compacted messages" className="opacity-60">
          {children}
        </section>
      )}
    </div>
  )
}
