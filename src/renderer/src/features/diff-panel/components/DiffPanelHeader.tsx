import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { useDiffViewOptions } from '../hooks/useDiffViewOptions'
import type { BaseRefChoice } from '../lib/base-ref-choices'
import { DiffScopeTabs } from './DiffScopeTabs'
import { DiffViewToolbar } from './DiffViewToolbar'

interface DiffPanelHeaderProps {
  readonly selection: DiffScopeSelection
  readonly baseRef: string | null
  readonly baseRefChoices: readonly BaseRefChoice[]
  readonly turns: readonly TurnCheckpointSummary[]
  readonly onSelectScope: (scope: 'branch' | 'unstaged' | 'turn') => void
  readonly onChangeBaseRef: (baseRef: string) => void
  readonly onSelectTurn: (turnId: string) => void
}

/** Scope tabs plus the diff view controls. */
export function DiffPanelHeader({
  selection,
  baseRef,
  baseRefChoices,
  turns,
  onSelectScope,
  onChangeBaseRef,
  onSelectTurn,
}: DiffPanelHeaderProps) {
  const { viewOptions, setDiffView, toggleWrapLines } = useDiffViewOptions()

  return (
    <div className="flex items-center gap-2 pr-2">
      <div className="min-w-0 flex-1">
        <DiffScopeTabs
          selection={selection}
          baseRef={baseRef}
          baseRefChoices={baseRefChoices}
          turns={turns}
          onSelectScope={onSelectScope}
          onChangeBaseRef={onChangeBaseRef}
          onSelectTurn={onSelectTurn}
        />
      </div>
      <DiffViewToolbar
        viewOptions={viewOptions}
        onSetDiffView={setDiffView}
        onToggleWrapLines={toggleWrapLines}
      />
    </div>
  )
}
