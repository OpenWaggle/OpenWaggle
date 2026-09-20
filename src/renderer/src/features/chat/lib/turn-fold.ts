import type { UIMessage } from '@shared/types/chat-ui'
import { formatElapsed } from '../hooks/useStreamingPhase'
import type { ChatRow, MessageChatRow, TurnFoldChatRow, WaggleTurnChatRow } from './types-chat-row'

export interface TurnFoldInput {
  readonly isLoading: boolean
  /** Duration of the just-settled run, when known (live phase timer). Applies to the last turn only. */
  readonly settledRunDurationMs: number | null
  /** Durable per-turn durations keyed by the turn's terminal assistant message id. */
  readonly turnDurationsByAnchorMessageId: ReadonlyMap<string, number>
  readonly interrupted: boolean
  /** Turn keys the user expanded; expanded turns render their full work. */
  readonly expandedTurnKeys: ReadonlySet<string>
}

interface AssistantRowEntry {
  readonly index: number
  readonly row: MessageChatRow
}

/** A foldable piece of transcript: one user-prompted segment or one Waggle agent turn. */
interface FoldableUnit {
  readonly turnKey: string
  /** Index of the terminal assistant message; used for duration precedence. */
  readonly terminalIndex: number
  readonly terminalMessageId: string
  readonly foldRowPlacementIndex: number
  readonly hasWork: boolean
  /** Assistant message rows to hide when folded (message segments only). */
  readonly hiddenRowIndexes: readonly number[]
  /** Waggle rows fold in place instead of hiding sibling rows. */
  readonly waggleRow?: { readonly index: number; readonly row: WaggleTurnChatRow }
}

interface FoldPlan {
  hiddenRowIndexes: Set<number>
  foldRowByPlacementIndex: Map<number, TurnFoldChatRow>
  foldedTerminalByIndex: Map<number, MessageChatRow>
  foldedWaggleByIndex: Map<number, WaggleTurnChatRow>
}

function isUserMessageRow(row: ChatRow): row is MessageChatRow {
  return row.type === 'message' && row.message.role === 'user'
}

function isAssistantMessageRow(row: ChatRow): row is MessageChatRow {
  return row.type === 'message' && row.message.role === 'assistant'
}

function hasFoldableWork(message: UIMessage) {
  return message.parts.some((part) => part.type === 'tool-call' || part.type === 'thinking')
}

function hasRenderableText(message: UIMessage) {
  return message.parts.some((part) => part.type === 'text' && part.content.trim().length > 0)
}

function segmentsStartAtUserMessages(rows: readonly ChatRow[]): FoldableUnit[] {
  const units: FoldableUnit[] = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row || !isUserMessageRow(row)) continue
    const assistantRows: AssistantRowEntry[] = []
    let cursor = index + 1
    while (cursor < rows.length) {
      const segmentRow = rows[cursor]
      if (!segmentRow || isUserMessageRow(segmentRow)) break
      if (isAssistantMessageRow(segmentRow)) {
        assistantRows.push({ index: cursor, row: segmentRow })
      }
      cursor += 1
    }
    const terminal = assistantRows.at(-1)
    if (terminal && hasRenderableText(terminal.row.message)) {
      units.push({
        turnKey: row.message.id,
        terminalIndex: terminal.index,
        terminalMessageId: terminal.row.message.id,
        foldRowPlacementIndex: index,
        hasWork: assistantRows.some((entry) => hasFoldableWork(entry.row.message)),
        hiddenRowIndexes: assistantRows
          .filter((entry) => entry.index !== terminal.index)
          .map((entry) => entry.index),
      })
    }
    index = cursor - 1
  }
  return units
}

function waggleTurnUnits(rows: readonly ChatRow[]): FoldableUnit[] {
  const units: FoldableUnit[] = []
  for (const [index, row] of rows.entries()) {
    if (row?.type !== 'waggle-turn') continue
    const messages = row.messages.filter((message) => message.message.role === 'assistant')
    let terminal: MessageChatRow | undefined
    for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
      const candidate = messages[cursor]
      if (candidate && hasRenderableText(candidate.message)) {
        terminal = candidate
        break
      }
    }
    if (!terminal) continue
    units.push({
      turnKey: row.id,
      terminalIndex: index,
      terminalMessageId: terminal.message.id,
      foldRowPlacementIndex: index,
      hasWork: messages.some((message) => hasFoldableWork(message.message)),
      hiddenRowIndexes: [],
      waggleRow: { index, row },
    })
  }
  return units
}

function foldLabel(interrupted: boolean, durationMs: number | null) {
  if (interrupted) {
    return durationMs !== null
      ? `You stopped after ${formatElapsed(durationMs)}`
      : 'You stopped this response'
  }
  return durationMs !== null ? `Worked for ${formatElapsed(durationMs)}` : 'Worked'
}

function planMessageSegmentFold(
  rows: readonly ChatRow[],
  unit: FoldableUnit,
  expanded: boolean,
  foldRow: TurnFoldChatRow,
  plan: FoldPlan,
) {
  plan.foldRowByPlacementIndex.set(unit.foldRowPlacementIndex, foldRow)
  if (expanded) return
  for (const hiddenIndex of unit.hiddenRowIndexes) plan.hiddenRowIndexes.add(hiddenIndex)
  const terminalRow = rows[unit.terminalIndex]
  if (terminalRow?.type === 'message') {
    plan.foldedTerminalByIndex.set(unit.terminalIndex, {
      ...terminalRow,
      turnPresentation: 'folded',
    })
  }
}

function planWaggleFold(
  unit: FoldableUnit,
  expanded: boolean,
  foldRow: TurnFoldChatRow,
  plan: FoldPlan,
) {
  const waggleRow = unit.waggleRow
  if (!waggleRow) return
  plan.foldedWaggleByIndex.set(waggleRow.index, {
    ...waggleRow.row,
    folded: !expanded,
    foldRow,
    messages: waggleRow.row.messages.map((message) =>
      !expanded && message.message.id === unit.terminalMessageId
        ? { ...message, turnPresentation: 'folded' }
        : message,
    ),
  })
}

function buildFoldPlan(
  rows: readonly ChatRow[],
  units: readonly FoldableUnit[],
  input: TurnFoldInput,
): FoldPlan {
  const plan: FoldPlan = {
    hiddenRowIndexes: new Set(),
    foldRowByPlacementIndex: new Map(),
    foldedTerminalByIndex: new Map(),
    foldedWaggleByIndex: new Map(),
  }

  for (const [position, unit] of units.entries()) {
    if (!unit.hasWork) continue
    const isLastUnit = position === units.length - 1
    const expanded = input.expandedTurnKeys.has(unit.turnKey)
    const durationMs =
      input.turnDurationsByAnchorMessageId.get(unit.terminalMessageId) ??
      (isLastUnit ? input.settledRunDurationMs : null)
    // Only the just-interrupted run's turn carries the You-stopped state; older
    // turns in the same branch stay "Worked for Xs".
    const interrupted = isLastUnit && input.interrupted
    const foldRow: TurnFoldChatRow = {
      type: 'turn-fold',
      id: `turn-fold:${unit.turnKey}`,
      turnKey: unit.turnKey,
      label: foldLabel(interrupted, durationMs),
      durationMs,
      interrupted,
      ...(unit.waggleRow ? { agentColor: unit.waggleRow.row.agentColor } : {}),
    }

    if (unit.waggleRow) {
      planWaggleFold(unit, expanded, foldRow, plan)
    } else {
      planMessageSegmentFold(rows, unit, expanded, foldRow, plan)
    }
  }

  return plan
}

/**
 * Turn settle-fold (ADR 0033): a settled turn's work collapses behind one
 * quiet row, keeping only the terminal assistant message (its final text part).
 * Turns without work, carve-out rows, and the active run are left untouched.
 * Waggle agent turns fold as colored units inside their own section.
 */
export function applyTurnFolds(rows: readonly ChatRow[], input: TurnFoldInput): ChatRow[] {
  if (input.isLoading) return [...rows]
  // A reset phase timer (0 on session load) is "unknown", not a zero-second run.
  const normalized: TurnFoldInput = {
    ...input,
    settledRunDurationMs:
      input.settledRunDurationMs !== null && input.settledRunDurationMs > 0
        ? input.settledRunDurationMs
        : null,
  }

  const units = [...segmentsStartAtUserMessages(rows), ...waggleTurnUnits(rows)].sort(
    (a, b) => a.terminalIndex - b.terminalIndex,
  )
  const plan = buildFoldPlan(rows, units, normalized)

  if (
    plan.hiddenRowIndexes.size === 0 &&
    plan.foldRowByPlacementIndex.size === 0 &&
    plan.foldedWaggleByIndex.size === 0
  ) {
    return [...rows]
  }

  const result: ChatRow[] = []
  for (const [index, row] of rows.entries()) {
    if (!plan.hiddenRowIndexes.has(index)) {
      result.push(
        plan.foldedTerminalByIndex.get(index) ?? plan.foldedWaggleByIndex.get(index) ?? row,
      )
    }
    const foldRow = plan.foldRowByPlacementIndex.get(index)
    if (foldRow) result.push(foldRow)
  }
  return result
}
