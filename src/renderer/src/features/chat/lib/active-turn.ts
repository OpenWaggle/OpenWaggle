import type { ChatRow } from './types-chat-row'

/**
 * Where the running turn starts while the Session runs: its user message, or null when the Session
 * is idle or no user message is shown. A steer the agent has not read yet renders last but steers
 * the turn before it, so it does not start a turn. The turn fold and the reply actions both use
 * this, so they agree on which turn is still running.
 */
export function activeTurnStartIndex(rows: readonly ChatRow[], isLoading: boolean): number | null {
  if (!isLoading) return null
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (
      row?.type === 'message' &&
      row.message.role === 'user' &&
      row.message.metadata?.steerDelivery === undefined
    ) {
      return index
    }
  }
  return null
}
