import { matchBy } from '@diegogbrisa/ts-match'
import type { ChatRow } from './types-chat-row'

export function chatRowKey(row: ChatRow) {
  return matchBy(row, 'type')
    .with('interrupted-run', (value) => `interrupted-run:${value.runId}`)
    .with('message', (value) => `message:${value.message.id}`)
    .with('waggle-turn', (value) => value.id)
    .with('turn-fold', (value) => `turn-fold:${value.turnKey}`)
    .with('worktree-launch', (value) => `worktree-launch:${value.id}`)
    .with(
      'agent-loop-custom-message',
      (value) => `custom:${value.event.timestamp}:${value.event.name}`,
    )
    .with(
      'agent-loop-interaction',
      (value) => `interaction:${value.item.request.interaction.interactionId}`,
    )
    .with('branch-summary', (value) => `branch-summary:${value.id}`)
    .with('compaction-summary', (value) => `compaction:${value.id}`)
    .with('compaction-status', (value) => `compaction-status:${value.id}`)
    .with('phase-indicator', (value) => `phase:${value.label}`)
    .with('retry-status', (value) => `retry:${String(value.attempt)}`)
    .with('error', (value) => `error:${value.sessionId ?? 'none'}:${value.error.message}`)
    .exhaustive()
}

/**
 * One unique key per row, in order.
 *
 * The transcript window and the scroll anchor address rows by key, so two rows sharing one (two
 * custom events in the same millisecond, say) would make the second unreachable. Repeats are
 * suffixed by occurrence, which is stable because rows only append or fold in place.
 */
export function chatRowKeys(rows: readonly ChatRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((row) => {
    const key = chatRowKey(row)
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    return count === 0 ? key : `${key}#${String(count + 1)}`
  })
}
