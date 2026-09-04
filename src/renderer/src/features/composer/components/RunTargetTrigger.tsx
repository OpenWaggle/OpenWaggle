import { ChevronDown, GitBranch } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { CONTEXT_MENU_TRIGGER_CLASS } from '@/shared/ui/menu-styles'

interface RunTargetTriggerProps {
  readonly readOnly?: boolean
  readonly disabled?: boolean
  readonly placeholder?: string
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
  readOnly = false,
  disabled = false,
  placeholder,
  selectedRef,
  isOpen,
  isMissing,
  onToggle,
}: RunTargetTriggerProps) {
  const label = selectedRef ?? placeholder ?? (isMissing ? 'Select a branch' : 'branch')

  if (readOnly) {
    return (
      <span
        className="flex min-w-0 items-center gap-2 text-sm text-text-secondary"
        title={`Current branch: ${label}`}
      >
        <GitBranch aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
        <span className="min-w-0 truncate">{label}</span>
      </span>
    )
  }

  return (
    <Button
      variant="unstyled"
      type="button"
      disabled={disabled}
      onClick={() => onToggle(!isOpen)}
      aria-expanded={isOpen}
      aria-label={`Run target: ${label}`}
      title="Choose the branch this run uses"
      className={cn(
        CONTEXT_MENU_TRIGGER_CLASS,
        'shrink whitespace-nowrap',
        isMissing && 'text-status-error',
      )}
    >
      <GitBranch aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
      <span className="min-w-0 truncate">{label}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
    </Button>
  )
}
