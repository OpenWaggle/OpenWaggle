import type { TranscriptRowIndex } from './transcript-sent-turn'
import type { ChatRow } from './types-chat-row'

/** Whether the turn from the sent row with this key on is doing work: tool calls or a Waggle turn. */
export function turnHasWork(rows: readonly ChatRow[], keys: readonly string[], sentKey: string) {
  const start = keys.indexOf(sentKey)
  if (start < 0) return false
  return rows.slice(start + 1).some((row) => {
    if (row.type === 'waggle-turn') return true
    if (row.type !== 'message' || row.message.role === 'user') return false
    return row.message.parts.some((part) => part.type === 'tool-call')
  })
}

/** The rows as the viewport controller reads them after a commit; `keys` align with `rows`. */
export function transcriptRowIndex(
  rows: readonly ChatRow[],
  keys: readonly string[],
): TranscriptRowIndex {
  return {
    keys,
    isUserRow: (key) => {
      const row = rows[keys.indexOf(key)]
      return row?.type === 'message' && row.message.role === 'user'
    },
    hasWorkAfter: (key) => turnHasWork(rows, keys, key),
  }
}

/** Session-node ids of the mounted message rows, for resource discovery. */
export function visibleMessageNodeIds(rows: readonly ChatRow[]) {
  const nodeIds: string[] = []
  for (const row of rows) {
    if (row.type === 'message') {
      nodeIds.push(row.message.metadata?.sessionNodeId ?? row.message.id)
      continue
    }
    if (row.type !== 'waggle-turn') continue
    for (const nested of row.messages) {
      nodeIds.push(nested.message.metadata?.sessionNodeId ?? nested.message.id)
    }
  }
  return nodeIds
}
