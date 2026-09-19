import type { GitStatusSummary } from '@shared/types/git'
import { FileDiff } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface DiffToggleButtonProps {
  readonly error: string | null
  readonly isChatRoute: boolean
  readonly isLoading: boolean
  readonly open: boolean
  readonly projectPath: string | null
  readonly status: GitStatusSummary | null
  readonly onToggle: () => void
}

function diffStatusText(error: string | null, isLoading: boolean) {
  if (isLoading) return 'Loading diff…'
  return error ? 'Git unavailable' : 'Diff unavailable'
}

export function DiffToggleButton({
  error,
  isChatRoute,
  isLoading,
  open,
  projectPath,
  status,
  onToggle,
}: DiffToggleButtonProps) {
  const disabled = !projectPath || !isChatRoute
  const gitStatusState = isLoading ? 'loading' : error ? 'error' : status ? 'ready' : 'unavailable'

  return (
    <Button
      variant="ghost"
      size="none"
      aria-label="Toggle diff panel"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'no-drag gap-1 hover:opacity-80 @max-[720px]/header:h-7 @max-[720px]/header:px-2',
        disabled && 'pointer-events-none opacity-30',
        open && 'opacity-100',
      )}
      title={
        status
          ? `Toggle diff panel: +${status.additions} -${status.deletions}`
          : 'Toggle diff panel'
      }
      data-git-status-state={gitStatusState}
    >
      <FileDiff aria-hidden="true" className="hidden size-3.5 @max-[720px]/header:block" />
      {status ? (
        <>
          <span className="text-sm font-medium text-success @max-[720px]/header:hidden">
            +{status.additions}
          </span>
          <span className="text-sm font-medium text-error @max-[720px]/header:hidden">
            -{status.deletions}
          </span>
        </>
      ) : (
        <span className="text-sm font-medium text-text-tertiary @max-[720px]/header:hidden">
          {diffStatusText(error, isLoading)}
        </span>
      )}
    </Button>
  )
}
