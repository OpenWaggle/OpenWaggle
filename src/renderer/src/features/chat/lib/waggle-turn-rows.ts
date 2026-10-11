import { sameWaggleTurn } from './chat-message-row-model'
import type { ChatRow, MessageChatRow, WaggleTurnChatRow } from './types-chat-row'

function getWaggleTurnId(meta: NonNullable<MessageChatRow['waggleMeta']>, firstMessageId: string) {
  return [
    'waggle-turn',
    meta.sessionId ?? 'session',
    String(meta.turnNumber),
    String(meta.agentIndex),
    firstMessageId,
  ].join(':')
}

function withoutInlineTurnDivider(row: MessageChatRow) {
  return {
    ...row,
    showTurnDivider: false,
    turnDividerProps: undefined,
  }
}

function isAgentLoopCard(row: ChatRow) {
  return row.type === 'agent-loop-custom-message' || row.type === 'agent-loop-interaction'
}

function continuesTurn(
  group: ChatRow | undefined,
  row: MessageChatRow,
): group is WaggleTurnChatRow {
  return (
    group?.type === 'waggle-turn' && sameWaggleTurn(row.waggleMeta, group.messages[0]?.waggleMeta)
  )
}

/**
 * Groups each Waggle agent's consecutive assistant rows into one turn row. An agent-loop card that
 * happened inside a turn follows the turn instead of splitting it in two.
 */
export function groupWaggleTurnRows(rows: readonly ChatRow[]) {
  const groupedRows: ChatRow[] = []
  let deferredCards: ChatRow[] = []
  const flushDeferredCards = () => {
    groupedRows.push(...deferredCards)
    deferredCards = []
  }

  for (const row of rows) {
    if (isAgentLoopCard(row) && groupedRows.at(-1)?.type === 'waggle-turn') {
      deferredCards.push(row)
      continue
    }
    if (row.type !== 'message' || row.message.role !== 'assistant' || !row.waggleMeta) {
      flushDeferredCards()
      groupedRows.push(row)
      continue
    }

    const previousRow = groupedRows.at(-1)
    if (continuesTurn(previousRow, row)) {
      groupedRows[groupedRows.length - 1] = {
        ...previousRow,
        messages: [...previousRow.messages, withoutInlineTurnDivider(row)],
      }
      continue
    }

    flushDeferredCards()
    groupedRows.push({
      type: 'waggle-turn',
      id: getWaggleTurnId(row.waggleMeta, row.message.id),
      agentColor: row.waggleMeta.agentColor,
      turnDividerProps: {
        turnNumber: row.waggleMeta.turnNumber,
        agentLabel: row.waggleMeta.agentLabel,
        agentColor: row.waggleMeta.agentColor,
        agentModel: row.waggleMeta.agentModel,
      },
      messages: [withoutInlineTurnDivider(row)],
    })
  }

  flushDeferredCards()
  return groupedRows
}

/** The Run error the error row shows, unless the user dismissed it. */
function shownRunError(rows: readonly ChatRow[]) {
  for (const row of rows) {
    if (row.type === 'error' && row.dismissedError !== row.error.message) return row.error.message
  }
  return undefined
}

function lastIndexOf(rows: readonly ChatRow[], matches: (row: ChatRow) => boolean) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row && matches(row)) return index
  }
  return -1
}

function isUserRow(row: ChatRow) {
  return row.type === 'message' && row.message.role === 'user'
}

/**
 * Whether the last turn's failure is left to another row: while the Run is loading it is the turn
 * in flight, whose failed attempt Pi may be retrying; and while the Run error row shows the same
 * Run's failure (or the same error), that row stands for it.
 */
function lastTurnFailureHidden(input: {
  readonly failure: string
  readonly inCurrentRun: boolean
  readonly isLoading: boolean
  readonly runError: string | undefined
}) {
  if (input.inCurrentRun && input.isLoading) return true
  if (input.runError === undefined) return false
  return input.inCurrentRun || input.failure === input.runError
}

/**
 * Marks each Waggle turn whose last response failed with that response's error. A response Pi
 * retried and a later one answered leaves no failure. The last turn's failure is not marked while
 * its Run is still loading, nor while the Run error row shows it.
 */
export function withWaggleTurnFailures(
  rows: readonly ChatRow[],
  run: { readonly isLoading?: boolean } = {},
): ChatRow[] {
  const currentRunStart = lastIndexOf(rows, isUserRow)
  const lastTurn = lastIndexOf(rows, (row) => row.type === 'waggle-turn')
  const runError = shownRunError(rows)
  return rows.map((row, index) => {
    if (row.type !== 'waggle-turn') return row
    const failure = row.messages.at(-1)?.message.metadata?.error
    if (!failure) return row
    const hidden =
      index === lastTurn &&
      lastTurnFailureHidden({
        failure,
        inCurrentRun: index > currentRunStart,
        isLoading: run.isLoading === true,
        runError,
      })
    return hidden ? row : { ...row, failure }
  })
}
