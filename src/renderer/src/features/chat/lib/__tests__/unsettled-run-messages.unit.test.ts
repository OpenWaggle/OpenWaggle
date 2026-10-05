import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import type { AgentCompactionStatus } from '../compaction-lifecycle'
import { placeUnsettledRunMessages, unsettledRunMessages } from '../seeded-run-messages'

function message(id: string, role: UIMessage['role'], order?: number): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content: id }],
    ...(order === undefined ? {} : { metadata: { sessionNodeCreatedOrder: order } }),
  }
}

/** A route's transcript: history, the settled Run 1 under stream ids, the active Run 2. */
const CACHED = [
  message('p1', 'user', 1),
  message('live-u1', 'user', 3),
  message('stream-a1', 'assistant'),
  message('live-u2', 'user', 5),
  message('stream-a2', 'assistant'),
]
const SETTLED = new Set(['p1', 'live-u1', 'stream-a1'])
const ids = (messages: readonly UIMessage[] | null) => messages?.map((entry) => entry.id) ?? null

describe('unsettledRunMessages', () => {
  it('leaves the settled Run to a persisted transcript that holds it', () => {
    const persistedMessages = [
      message('p1', 'user', 1),
      message('n-u1', 'user', 3),
      message('n-a1', 'assistant'),
    ]
    expect(
      ids(
        unsettledRunMessages({
          persistedMessages,
          cachedMessages: CACHED,
          settledMessageIds: SETTLED,
        }),
      ),
    ).toEqual(['live-u2', 'stream-a2'])
  })

  it('keeps the settled rows while the persisted transcript does not hold that Run yet', () => {
    expect(
      unsettledRunMessages({
        persistedMessages: [message('p1', 'user', 1)],
        cachedMessages: CACHED,
        settledMessageIds: SETTLED,
      }),
    ).toBeNull()
  })

  it('keeps settled assistant rows no user row of their Run vouches for', () => {
    expect(
      unsettledRunMessages({
        persistedMessages: [message('p1', 'user', 1), message('n-a1', 'assistant')],
        cachedMessages: [message('p1', 'user', 1), message('stream-a1', 'assistant')],
        settledMessageIds: new Set(['p1', 'stream-a1']),
      }),
    ).toBeNull()
  })

  it('takes settled rows persisted under their own ids as the history', () => {
    expect(
      ids(
        unsettledRunMessages({
          persistedMessages: [message('p1', 'user', 1)],
          cachedMessages: [message('p1', 'user', 1), message('stream-a2', 'assistant')],
          settledMessageIds: new Set(['p1']),
        }),
      ),
    ).toEqual(['stream-a2'])
  })

  it('has nothing to leave without settled ids', () => {
    expect(
      unsettledRunMessages({
        persistedMessages: [],
        cachedMessages: CACHED,
        settledMessageIds: undefined,
      }),
    ).toBeNull()
  })
})

function completedCompaction(anchors: readonly number[]): AgentCompactionStatus {
  return {
    type: 'completed',
    reason: 'threshold',
    summaryCountAtStart: 0,
    timeline: anchors.map((messageCountAtStart, index) => ({
      id: `compaction-${String(index)}`,
      phase: 'completed',
      reason: 'threshold',
      summaryCountAtStart: 0,
      messageCountAtStart,
    })),
  }
}

describe('placeUnsettledRunMessages', () => {
  it('keeps a settled user row not persisted yet and leaves the rest of the Run', () => {
    // An optimistic Follow-up the route showed when the previous Run settled.
    const placed = placeUnsettledRunMessages({
      persistedMessages: [
        message('p1', 'user', 1),
        message('n-u1', 'user', 3),
        message('n-a1', 'assistant'),
      ],
      cachedMessages: [...CACHED.slice(0, 3), message('optimistic-u2', 'user')],
      settledMessageIds: new Set([...SETTLED, 'optimistic-u2']),
      compactionStatus: null,
    })

    expect(ids(placed?.messages ?? null)).toEqual(['p1', 'n-u1', 'n-a1', 'optimistic-u2'])
  })

  const persistedMessages = [
    message('p1', 'user', 1),
    message('n-u1', 'user', 3),
    message('n-a1', 'assistant'),
  ]

  it('moves a compaction after the settled rows past the persisted history', () => {
    // Anchored after p1 (history), after Run 1, and after Run 2's prompt.
    const placed = placeUnsettledRunMessages({
      persistedMessages,
      cachedMessages: CACHED,
      settledMessageIds: SETTLED,
      compactionStatus: completedCompaction([1, 3, 4]),
    })

    expect(ids(placed?.messages ?? null)).toEqual(['p1', 'n-u1', 'n-a1', 'live-u2', 'stream-a2'])
    expect(placed?.compactionStatus).toMatchObject({
      timeline: [
        { messageCountAtStart: 1 },
        { messageCountAtStart: 3 },
        { messageCountAtStart: 4 },
      ],
    })
  })

  it('anchors a hidden Run compaction recorded against its own rows after the history', () => {
    const placed = placeUnsettledRunMessages({
      persistedMessages,
      cachedMessages: [message('live-u1', 'user', 3), message('stream-a1', 'assistant')],
      settledMessageIds: new Set(['live-u1', 'stream-a1']),
      compactionStatus: completedCompaction([2]),
    })

    expect(ids(placed?.messages ?? null)).toEqual(['p1', 'n-u1', 'n-a1'])
    expect(placed?.compactionStatus).toMatchObject({ timeline: [{ messageCountAtStart: 3 }] })
  })
})
