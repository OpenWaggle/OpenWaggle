import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { afterEach, describe, expect, it } from 'vitest'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import { appendMissingOptimisticUserMessages } from '../chat-message-reconciliation'
import { unsettledRunMessages } from '../seeded-run-messages'

/*
 * ADR 0048: the persisted transcript holds the history above a compaction marker too, with old
 * "continue" / "Done." rows. Matching a send or a settled answer by text must start at its own Run.
 */

const SESSION = SessionId('compacted-history-session')
const SENT_AT = 10_000

function message(
  id: string,
  role: UIMessage['role'],
  text: string,
  at: { readonly order?: number; readonly createdAt: number },
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content: text }],
    createdAt: new Date(at.createdAt),
    ...(at.order === undefined ? {} : { metadata: { sessionNodeCreatedOrder: at.order } }),
  }
}

/** History above the marker, the marker, and a kept turn: all saved before the send. */
const PERSISTED = [
  message('p-u1', 'user', 'continue', { order: 1, createdAt: 1 }),
  message('p-a1', 'assistant', 'Done.', { order: 2, createdAt: 2 }),
  {
    ...message('p-c', 'assistant', 'Compaction summary', { createdAt: 3 }),
    metadata: { compactionSummary: { summary: 's', tokensBefore: 1 } },
  },
  message('p-u2', 'user', 'other prompt', { order: 4, createdAt: 4 }),
  message('p-a2', 'assistant', 'other answer', { order: 5, createdAt: 5 }),
]
const ids = (messages: readonly UIMessage[] | null) => messages?.map((entry) => entry.id) ?? null

describe('unsettledRunMessages over compacted history', () => {
  it('keeps a settled Run whose send has no log order yet: an older "continue" is no copy', () => {
    const settled = [
      message('opt-1', 'user', 'continue', { createdAt: SENT_AT }),
      message('stream-1', 'assistant', 'Done.', { createdAt: SENT_AT + 1 }),
    ]
    expect(
      unsettledRunMessages({
        persistedMessages: PERSISTED,
        cachedMessages: settled,
        settledMessageIds: new Set(settled.map((entry) => entry.id)),
      }),
    ).toBeNull()
  })

  it('keeps a settled answer alone after the history: an older "Done." is no copy', () => {
    const cached = [...PERSISTED, message('stream-1', 'assistant', 'Done.', { createdAt: SENT_AT })]
    expect(
      unsettledRunMessages({
        persistedMessages: PERSISTED,
        cachedMessages: cached,
        settledMessageIds: new Set(['stream-1']),
      }),
    ).toBeNull()
  })

  it('still leaves the settled Run to its saved copies', () => {
    const settled = [
      message('opt-1', 'user', 'continue', { createdAt: SENT_AT }),
      message('stream-1', 'assistant', 'Done.', { createdAt: SENT_AT + 1 }),
    ]
    const saved = [
      ...PERSISTED,
      message('n-u3', 'user', 'continue', { order: 6, createdAt: SENT_AT + 1 }),
      message('n-a3', 'assistant', 'Done.', { order: 7, createdAt: SENT_AT + 2 }),
    ]
    expect(
      ids(
        unsettledRunMessages({
          persistedMessages: saved,
          cachedMessages: [...PERSISTED, ...settled],
          settledMessageIds: new Set(settled.map((entry) => entry.id)),
        }),
      ),
    ).toEqual(ids(PERSISTED))
  })
})

describe('optimistic sends over compacted history', () => {
  afterEach(() => useOptimisticUserMessageStore.getState().clear(SESSION))
  const sent = message('opt-2', 'user', 'continue', { createdAt: SENT_AT })

  it('keeps a new "continue" the transcript holds only an older one of', () => {
    const shown = appendMissingOptimisticUserMessages([...PERSISTED], [sent])
    expect(shown.some((entry) => entry.id === 'opt-2')).toBe(true)
    useOptimisticUserMessageStore.getState().add(SESSION, sent)
    useOptimisticUserMessageStore.getState().removeMatched(SESSION, PERSISTED)
    expect(
      ids(useOptimisticUserMessageStore.getState().messagesBySessionId.get(SESSION) ?? []),
    ).toEqual(['opt-2'])
  })

  it('takes the copy the Host saved after the send', () => {
    const saved = [
      ...PERSISTED,
      message('n-u3', 'user', 'continue', { order: 6, createdAt: SENT_AT + 1 }),
    ]
    const shown = appendMissingOptimisticUserMessages([...saved], [sent])
    expect(shown.some((entry) => entry.id === 'opt-2')).toBe(false)
    useOptimisticUserMessageStore.getState().add(SESSION, sent)
    useOptimisticUserMessageStore.getState().removeMatched(SESSION, saved)
    expect(
      useOptimisticUserMessageStore.getState().messagesBySessionId.get(SESSION),
    ).toBeUndefined()
  })
})
