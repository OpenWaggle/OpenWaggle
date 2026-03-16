import { ChevronDown, ChevronUp } from 'lucide-react'

interface CollapsibleDetailsProps {
  showDetails: boolean
  collapseLabel: string
  onToggle: () => void
}

export function CollapsibleDetails({
  showDetails,
  collapseLabel,
  onToggle,
}: CollapsibleDetailsProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex items-center gap-2 w-full py-1 text-text-muted hover:text-text-secondary transition-colors group"
      onClick={onToggle}
    >
      <span className="h-px flex-1 bg-border group-hover:bg-border-light transition-colors" />
      <span className="flex items-center gap-1 text-xs shrink-0 select-none">
        {showDetails ? 'Hide details' : collapseLabel}
        {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </span>
      <span className="h-px flex-1 bg-border group-hover:bg-border-light transition-colors" />
    </button>
  )
}
