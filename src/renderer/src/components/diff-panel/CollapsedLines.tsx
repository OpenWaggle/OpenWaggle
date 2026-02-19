import { ChevronRight } from 'lucide-react'

interface CollapsedLinesProps {
  count: number
  onClick: () => void
}

export function CollapsedLines({ count, onClick }: CollapsedLinesProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 h-6 w-full pl-8 bg-diff-bg text-left hover:bg-bg-hover transition-colors"
    >
      <ChevronRight className="h-[11px] w-[11px] text-text-tertiary shrink-0" />
      <span className="text-[12px] text-text-tertiary">
        {count} unmodified line{count !== 1 ? 's' : ''}
      </span>
    </button>
  )
}
