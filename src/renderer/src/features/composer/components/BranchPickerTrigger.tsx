import { GitBranch } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

interface BranchPickerTriggerProps {
  readonly currentBranch: string | null
  readonly isOpen: boolean
  readonly onToggle: (open: boolean) => void
}

export function BranchPickerTrigger({ currentBranch, isOpen, onToggle }: BranchPickerTriggerProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => onToggle(!isOpen)}
      className="flex h-6 min-w-0 shrink items-center gap-1 whitespace-nowrap rounded-[5px] border border-border px-2 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
      title="Manage branches"
    >
      <GitBranch className="size-[13px] shrink-0 text-text-tertiary" />
      <span className="min-w-0 truncate">{currentBranch ?? 'branch'}</span>
      <span className="shrink-0 text-[9px] text-text-tertiary">&#x2228;</span>
    </Button>
  )
}
