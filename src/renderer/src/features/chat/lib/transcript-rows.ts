import type { ChatRow } from './types-chat-row'

/** Whether the turn after the last user message has started tool work or a Waggle turn. */
export function latestTurnHasToolActivity(rows: readonly ChatRow[]) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!row) continue
    if (row.type === 'waggle-turn') return true
    if (row.type !== 'message') continue
    if (row.message.role === 'user') return false
    if (row.message.parts.some((part) => part.type === 'tool-call')) return true
  }
  return false
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
