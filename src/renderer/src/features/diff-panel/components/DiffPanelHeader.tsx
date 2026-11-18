import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { FolderTree } from 'lucide-react'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { useDiffViewOptions } from '../hooks/useDiffViewOptions'
import { type BaseRefControlState, DiffScopeTabs } from './DiffScopeTabs'
import { DiffViewToolbar } from './DiffViewToolbar'

interface DiffPanelHeaderProps {
  readonly selection: DiffScopeSelection
  readonly baseRefControl: BaseRefControlState
  readonly turns: readonly TurnCheckpointSummary[]
  readonly onSelectScope: (scope: 'branch' | 'unstaged' | 'turn') => void
  readonly onSelectTurn: (turnId: string) => void
}

/** Scope tabs plus the diff view controls. */
export function DiffPanelHeader({
  selection,
  baseRefControl,
  turns,
  onSelectScope,
  onSelectTurn,
}: DiffPanelHeaderProps) {
  const { viewOptions, setDiffView, toggleWrapLines } = useDiffViewOptions()
  const workspaceTreeOpen = useUIStore((state) => state.workspaceTreeOpen)
  const toggleWorkspaceTree = useUIStore((state) => state.toggleWorkspaceTree)

  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <DiffScopeTabs
          selection={selection}
          baseRefControl={baseRefControl}
          turns={turns}
          onSelectScope={onSelectScope}
          onSelectTurn={onSelectTurn}
        />
      </div>
      <DiffViewToolbar
        viewOptions={viewOptions}
        onSetDiffView={setDiffView}
        onToggleWrapLines={toggleWrapLines}
      />
      <Button
        variant={workspaceTreeOpen ? 'accent' : 'ghost'}
        size="icon-sm"
        aria-label="Toggle workspace navigator"
        aria-pressed={workspaceTreeOpen}
        title="Toggle workspace navigator"
        onClick={toggleWorkspaceTree}
      >
        <FolderTree className="size-3.5" />
      </Button>
    </div>
  )
}
