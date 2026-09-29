import type { ChatRow } from './types-chat-row'

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
