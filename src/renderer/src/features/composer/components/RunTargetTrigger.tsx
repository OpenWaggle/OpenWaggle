import { GitBranch } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface RunTargetTriggerProps {
  readonly selectedRef: string | null
  readonly isOpen: boolean
  readonly isMissing: boolean
  readonly onToggle: (open: boolean) => void
}

/**
 * The one control that answers "which ref does my next send run on?".
 *
 * It deliberately shows the resolved ref for the current environment mode: the
 * checked-out branch when running in place, the chosen base ref when a worktree
 * will be created. Showing the same branch string in two places is what made the
 * old two-control row ambiguous.
 */
export function RunTargetTrigger({
  selectedRef,
  isOpen,
  isMissing,
  onToggle,
}: RunTargetTriggerProps) {
  const label = selectedRef ?? (isMissing ? 'Select a branch' : 'branch')

  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => onToggle(!isOpen)}
      aria-expanded={isOpen}
      aria-label={`Run target: ${label}`}
      title="Choose the branch this run uses"
      className={cn(
        'flex h-6 min-w-0 shrink items-center gap-1 whitespace-nowrap rounded-[5px] border border-border px-2 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover',
        isMissing && 'border-status-error/60',
      )}
    >
      <GitBranch className="size-[13px] shrink-0 text-text-tertiary" />
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 text-[9px] text-text-tertiary">&#x2228;</span>
    </Button>
  )
}
