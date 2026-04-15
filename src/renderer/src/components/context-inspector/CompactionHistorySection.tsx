import type { Message } from '@shared/types/agent'
import { isCompactionEventPart } from '@shared/types/agent'
import type { CompactionEventData } from '@shared/types/context'
import { ChevronRight, History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatTokens } from '@/lib/format-tokens'

interface CompactionHistorySectionProps {
  readonly messages: readonly Message[]
}

const MAX_HISTORY_ENTRIES = 5

export function CompactionHistorySection({ messages }: CompactionHistorySectionProps) {
  const [expanded, setExpanded] = useState(false)

  const { events, recentEvents } = useMemo(() => {
    const allEvents: CompactionEventData[] = []
    for (const msg of messages) {
      if (msg.role !== 'system') continue
      for (const part of msg.parts) {
        if (isCompactionEventPart(part)) {
          allEvents.push(part.data)
        }
      }
    }
    return {
      events: allEvents,
      recentEvents: allEvents.slice(-MAX_HISTORY_ENTRIES).reverse(),
    }
  }, [messages])

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-[12px] text-text-muted hover:text-text-secondary hover:bg-bg-hover/50 transition-colors"
      >
        <ChevronRight
          className={cn('h-3 w-3 transition-transform duration-150', expanded && 'rotate-90')}
        />
        <History className="h-3 w-3" />
        <span className="font-medium">Compaction History</span>
        {events.length > 0 && (
          <span className="ml-auto rounded-full bg-bg-hover px-1.5 py-0.5 text-[10px] text-text-muted tabular-nums">
            {events.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-1.5">
          {recentEvents.length === 0 ? (
            <p className="py-1 text-[11px] text-text-muted leading-relaxed">
              No compactions yet. OpenWaggle keeps headroom so replies and tool output still fit.
            </p>
          ) : (
            recentEvents.map((event, index) => (
              <div
                key={`${String(event.timestamp)}-${event.tier}-${event.trigger}-${String(index)}`}
                className="rounded-lg bg-bg-tertiary/50 border border-border/50 px-3 py-2 space-y-1"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-text-secondary">
                    {event.trigger === 'manual' ? 'Manual' : 'Auto'}
                    <span className="text-text-muted font-normal"> · {event.tier}</span>
                  </span>
                  <span className="text-text-muted font-mono tabular-nums">
                    {formatTimestamp(event.timestamp)}
                  </span>
                </div>
                {event.metrics && (
                  <div className="text-[11px] text-text-muted font-mono tabular-nums">
                    {event.metrics.messagesSummarized} msgs ·{' '}
                    {formatTokens(event.metrics.tokensBefore)} →{' '}
                    {formatTokens(event.metrics.tokensAfter)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
