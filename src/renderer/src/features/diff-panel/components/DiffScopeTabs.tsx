import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import type { BaseRefChoice } from '@/features/diff-panel/lib/base-ref-choices'
import type { DiffScopeSelection } from '@/features/diff-panel/state/diff-scope-store'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

type ScopeKind = 'branch' | 'unstaged' | 'turn'

/**
 * Everything the base-ref control needs, grouped because it is one concern.
 *
 * `resolvedAutomatic` and `fellBackToWorkingTree` come from the load result: the control is the
 * only place that says which base a diff was taken against, so it has to report what Automatic
 * actually chose rather than merely promising a choice.
 */
export interface BaseRefControlState {
  readonly current: string | null
  readonly choices: readonly BaseRefChoice[]
  /** Whether `choices` reflects a successful read, so a missing ref really is missing. */
  readonly choicesLoaded: boolean
  readonly resolvedAutomatic: string | null
  readonly fellBackToWorkingTree: boolean
  readonly onChange: (baseRef: string) => void
}

interface DiffScopeTabsProps {
  readonly selection: DiffScopeSelection
  readonly baseRefControl: BaseRefControlState
  readonly turns: readonly TurnCheckpointSummary[]
  readonly onSelectScope: (scope: ScopeKind) => void
  readonly onSelectTurn: (turnId: string) => void
}

const AUTOMATIC_VALUE = ''

/** Name the branch Automatic chose, so the label stops being an unauditable promise. */
function automaticOptionLabel(automaticBaseRef: string | null) {
  return automaticBaseRef === null ? 'Automatic' : `Automatic · ${automaticBaseRef}`
}

/**
 * Diff scope selector (WS6): switch between the working-tree diff, a branch diff
 * against a base ref (combobox with an "Automatic" default + branch choices),
 * and per-turn Turn diffs. The Turns tab appears only when the session has
 * captured Turn checkpoints.
 */
export function DiffScopeTabs({
  selection,
  baseRefControl,
  turns,
  onSelectScope,
  onSelectTurn,
}: DiffScopeTabsProps) {
  const { current: baseRef, choices: baseRefChoices } = baseRefControl
  const selectedTurnId = selection.kind === 'turn' ? selection.turnId : ''
  return (
    <div className="flex items-center gap-2 h-9 px-4 border-b border-border shrink-0">
      {/*
        `aria-pressed` on each tab: selection was signalled by colour alone, so a screen-reader or
        high-contrast user heard three identical buttons with no way to tell which tree they were
        reviewing - and the active scope decides both what is shown and what the quick action
        operates on. The sibling view toolbar in this same header already does this.
      */}
      <Button
        variant="unstyled"
        type="button"
        aria-pressed={selection.kind === 'unstaged'}
        onClick={() => onSelectScope('unstaged')}
        className={tabClass(selection.kind === 'unstaged')}
      >
        Working tree
      </Button>
      <Button
        variant="unstyled"
        type="button"
        aria-pressed={selection.kind === 'branch'}
        onClick={() => onSelectScope('branch')}
        className={tabClass(selection.kind === 'branch')}
      >
        Branch
      </Button>
      {turns.length > 0 ? (
        <Button
          variant="unstyled"
          type="button"
          aria-pressed={selection.kind === 'turn'}
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
          onChange={(event) => baseRefControl.onChange(event.target.value)}
          className="ml-1 max-w-[240px]"
        >
          <option value={AUTOMATIC_VALUE}>
            {automaticOptionLabel(baseRefControl.resolvedAutomatic)}
          </option>
          {/*
            The persisted ref is rendered even when it is not among the choices. Choices arrive
            asynchronously and a deleted ref never arrives at all, so a select whose value matched
            no option fell back to displaying the first one - "Automatic" - while the diff was
            computed against something else entirely. One change event would then have silently
            rewritten the stored ref to empty.
          */}
          {baseRef !== null && !baseRefChoices.some((choice) => choice.label === baseRef) ? (
            <option value={baseRef}>
              {baseRefControl.choicesLoaded ? `${baseRef} (unavailable)` : baseRef}
            </option>
          ) : null}
          {baseRefChoices.map((choice) => (
            <option key={choice.id} value={choice.label}>
              {choice.label}
            </option>
          ))}
        </Select>
      ) : null}

      {selection.kind === 'branch' && baseRefControl.fellBackToWorkingTree ? (
        // Automatic resolved no default branch, so this is the working-tree diff under a tab that
        // claims a branch comparison. Announced, not merely visible, for the same reason.
        <span role="status" className="text-[11px] text-text-tertiary">
          No default branch; showing the working tree
        </span>
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
