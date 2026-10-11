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

function runErrorShows(rows: readonly ChatRow[]) {
  return rows.some((row) => row.type === 'error' && row.dismissedError !== row.error.message)
}

/**
 * Marks each Waggle turn whose last response failed with that response's error. A response Pi
 * retried and a later one answered leaves no failure. While the Run error row shows, it stands for
 * the Run's last failed turn, so that turn does not repeat the error.
 */
export function withWaggleTurnFailures(rows: readonly ChatRow[]): ChatRow[] {
  const marked = rows.map((row) => {
    if (row.type !== 'waggle-turn') return row
    const failure = row.messages.at(-1)?.message.metadata?.error
    return failure ? { ...row, failure } : row
  })
  if (!runErrorShows(rows)) return marked
  for (let index = marked.length - 1; index >= 0; index -= 1) {
    const row = marked[index]
    if (row?.type !== 'waggle-turn') continue
    const { failure: _shownByRunError, ...turn } = row
    marked[index] = turn
    break
  }
  return marked
}
