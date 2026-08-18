import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import type { BaseRefChoice } from '@/features/diff-panel/lib/base-ref-choices'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

type ScopeKind = 'branch' | 'unstaged' | 'turn'

interface DiffScopeTabsProps {
  readonly selection: DiffScopeSelection
  readonly baseRef: string | null
  readonly baseRefChoices: readonly BaseRefChoice[]
  readonly turns: readonly TurnCheckpointSummary[]
  readonly onSelectScope: (scope: ScopeKind) => void
  readonly onChangeBaseRef: (baseRef: string) => void
  readonly onSelectTurn: (turnId: string) => void
}

const AUTOMATIC_VALUE = ''

/**
 * Diff scope selector (WS6): switch between the working-tree diff, a branch diff
 * against a base ref (combobox with an "Automatic" default + branch choices),
 * and per-turn Turn diffs. The Turns tab appears only when the session has
 * captured Turn checkpoints.
 */
export function DiffScopeTabs({
  selection,
  baseRef,
  baseRefChoices,
  turns,
  onSelectScope,
  onChangeBaseRef,
  onSelectTurn,
}: DiffScopeTabsProps) {
  const selectedTurnId = selection.kind === 'turn' ? selection.turnId : ''
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
        className={tabClass(selection.kind === 'branch')}
      >
        Branch
      </Button>
      {turns.length > 0 ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onSelectScope('turn')}
          className={tabClass(selection.kind === 'turn')}
        >
          Turns
        </Button>
      ) : null}

      {selection.kind === 'branch' ? (
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

      {selection.kind === 'turn' ? (
        <Select
          aria-label="Turn"
          value={selectedTurnId}
          onChange={(event) => onSelectTurn(event.target.value)}
          className="ml-1 max-w-[240px]"
        >
          {turns.map((turn) => (
            <option key={turn.turnId} value={turn.turnId}>
              {`Turn ${String(turn.turnIndex + 1)} (+${String(turn.insertions)} −${String(turn.deletions)})`}
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
