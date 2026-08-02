import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { Button } from '@/shared/ui/Button'

interface DiffScopeTabsProps {
  readonly selection: DiffScopeSelection
  readonly baseRef: string | null
  readonly onSelectScope: (scope: 'branch' | 'unstaged') => void
  readonly onChangeBaseRef: (baseRef: string) => void
}

/**
 * Diff scope selector (WS6): switch between the working-tree diff and a
 * branch diff against a base ref. The turn scope is driven elsewhere.
 */
export function DiffScopeTabs({
  selection,
  baseRef,
  onSelectScope,
  onChangeBaseRef,
}: DiffScopeTabsProps) {
  const isBranch = selection.kind === 'branch'
  return (
    <div className="flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onSelectScope('unstaged')}
        className={tabClass(selection.kind === 'unstaged')}
      >
        Working tree
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onSelectScope('branch')}
        className={tabClass(isBranch)}
      >
        Branch
      </Button>
      {isBranch ? (
        <input
          type="text"
          value={baseRef ?? ''}
          placeholder="base ref (e.g. origin/main)"
          onChange={(event) => onChangeBaseRef(event.target.value)}
          className="ml-1 h-[24px] flex-1 min-w-0 max-w-[240px] rounded-[5px] border border-button-border bg-transparent px-2 text-[12px] text-text-secondary"
        />
      ) : null}
    </div>
  )
}

function tabClass(active: boolean) {
  return `h-[24px] px-2 rounded-[5px] text-[12px] ${
    active ? 'bg-diff-stage-bg text-accent font-medium' : 'text-text-tertiary hover:bg-bg-hover'
  }`
}
