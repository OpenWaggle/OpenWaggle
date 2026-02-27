import { Brain, ChevronRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

interface ThinkingBlockProps {
  content: string
  isStreaming?: boolean
}

export function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  const tokenEstimate = Math.ceil(content.length / 4)

  return (
    <div className="group/thinking">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 py-0.5 text-[13px] transition-colors"
      >
        {isStreaming ? (
          <Loader2 className="h-3.5 w-3.5 text-text-tertiary animate-spin shrink-0" />
        ) : (
          <Brain className="h-3.5 w-3.5 text-text-muted shrink-0" />
        )}
        <span className="text-text-muted truncate">
          {isStreaming ? 'Reasoning...' : `Reasoned for ${String(tokenEstimate)} tokens`}
        </span>
        <ChevronRight
          className={cn(
            'ml-auto h-3 w-3 text-text-muted shrink-0 transition-transform',
            'invisible group-hover/thinking:visible',
            expanded && 'visible rotate-90',
          )}
        />
      </button>

      {expanded && (
        <div className="ml-5 mt-1 max-h-[300px] overflow-y-auto rounded-md border border-border bg-bg-secondary/50 p-3">
          <div className="text-xs text-text-tertiary whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </div>
        </div>
      )}
    </div>
  )
}
