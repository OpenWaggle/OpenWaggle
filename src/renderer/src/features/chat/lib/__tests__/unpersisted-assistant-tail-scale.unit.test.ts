import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { appendUnpersistedAssistantTail } from '../chat-message-reconciliation'

/*
 * ADR 0048: a transcript holds a Session's whole history, thousands of messages. Aligning a
 * snapshot with the shown transcript scans it forward once: the comparisons stay linear.
 */

const HISTORY_MESSAGES = 12_000
// Each existing message is visited a few times at most; a rescan per snapshot message is ~n²/2.
const MAX_VISITS_PER_MESSAGE = 8

/** The messages, counting each read of one of them. */
function counted(messages: readonly UIMessage[], reads: { count: number }) {
  return new Proxy([...messages], {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) reads.count += 1
      return Reflect.get(target, property, receiver)
    },
  })
}

function history(count: number): UIMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${String(index)}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    parts: [{ type: 'text', content: index % 2 === 0 ? 'continue' : 'Done.' }],
    metadata: { sessionNodeCreatedOrder: index },
  }))
}

describe('appendUnpersistedAssistantTail at scale', () => {
  it('aligns a long snapshot with the shown transcript in one forward scan', () => {
    const snapshot = history(HISTORY_MESSAGES)
    const unsaved: UIMessage = { id: 'stream-1', role: 'assistant', parts: [] }
    const reads = { count: 0 }
    const existing = counted([...snapshot, unsaved], reads)

    const merged = appendUnpersistedAssistantTail(snapshot, existing)

    expect(merged.at(-1)?.id).toBe('stream-1')
    expect(merged).toHaveLength(HISTORY_MESSAGES + 1)
    expect(reads.count).toBeLessThan(MAX_VISITS_PER_MESSAGE * (HISTORY_MESSAGES + 1))
  })
})
