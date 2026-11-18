import type { DiffView } from '@shared/types/settings'
import { Columns2, Rows3, WrapText } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { DiffViewOptions } from './DiffCodeView'

interface DiffViewToolbarProps {
  readonly viewOptions: DiffViewOptions
  readonly onSetDiffView: (view: DiffView) => void
  readonly onToggleWrapLines: () => void
}

const TOGGLE_CLASS = 'flex size-6 items-center justify-center rounded-md border transition-colors'

function toggleClassName(active: boolean) {
  return active
    ? `${TOGGLE_CLASS} border-accent bg-diff-stage-bg text-accent`
    : `${TOGGLE_CLASS} border-transparent text-text-tertiary hover:bg-bg-hover hover:text-text-primary`
}

/**
 * View controls for the diff. These write through to the persisted setting rather
 * than to local state, so the panel and Settings > Appearance always agree.
 */
export function DiffViewToolbar({
  viewOptions,
  onSetDiffView,
  onToggleWrapLines,
}: DiffViewToolbarProps) {
  const isSplit = viewOptions.diffView === 'split'
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="unstyled"
        type="button"
        onClick={onToggleWrapLines}
        aria-pressed={viewOptions.wrapLines}
        aria-label={viewOptions.wrapLines ? 'Disable line wrapping' : 'Enable line wrapping'}
        title={viewOptions.wrapLines ? 'Disable line wrapping' : 'Enable line wrapping'}
        className={toggleClassName(viewOptions.wrapLines)}
      >
        <WrapText className="size-3.5" />
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onSetDiffView(isSplit ? 'unified' : 'split')}
        aria-pressed={isSplit}
        aria-label={isSplit ? 'Switch to unified view' : 'Switch to split view'}
        title={isSplit ? 'Switch to unified view' : 'Switch to split view'}
        className={toggleClassName(isSplit)}
      >
        {isSplit ? <Columns2 className="size-3.5" /> : <Rows3 className="size-3.5" />}
      </Button>
    </div>
  )
}
