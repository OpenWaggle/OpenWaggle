import type { BaseRefChoice } from '@/features/diff-panel/lib/base-ref-choices'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

interface DiffScopeTabsProps {
  readonly selection: DiffScopeSelection
  readonly baseRef: string | null
  readonly baseRefChoices: readonly BaseRefChoice[]
  readonly onSelectScope: (scope: 'branch' | 'unstaged') => void
  readonly onChangeBaseRef: (baseRef: string) => void
}

const AUTOMATIC_VALUE = ''

/**
 * Diff scope selector (WS6): switch between the working-tree diff and a branch
 * diff against a base ref. The base ref is chosen from a combobox with an
 * "Automatic" default plus the repository's branches (mirrors T3Code
 * buildBaseRefChoices). The turn scope is driven elsewhere.
 */
export function DiffScopeTabs({
  selection,
  baseRef,
  baseRefChoices,
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
        <Select
          aria-label="Branch diff base ref"
          value={baseRef ?? AUTOMATIC_VALUE}
          onChange={(event) => onChangeBaseRef(event.target.value)}
          className="ml-1 max-w-[240px]"
        >
          <option value={AUTOMATIC_VALUE}>Automatic</option>
          {baseRefChoices.map((choice) => (
            <option key={choice.id} value={choice.label}>
              {choice.label}
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  )
}

function tabClass(active: boolean) {
  return `h-[24px] px-2 rounded-[5px] text-[12px] ${
    active ? 'bg-diff-stage-bg text-accent font-medium' : 'text-text-tertiary hover:bg-bg-hover'
  }`
}
