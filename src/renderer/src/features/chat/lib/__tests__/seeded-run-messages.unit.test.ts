import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { reconcileSnapshotUserMessages } from '../chat-message-reconciliation'
import { mergeBackgroundReconnectMessages } from '../chat-reconnect-merge'
import { placeReconnectedRunMessages } from '../chat-stream-user-messages'
import { type AgentCompactionStatus, acknowledgeCompactionStatus } from '../compaction-lifecycle'
import { placeSeededRunMessages } from '../seeded-run-messages'

function user(id: string, content: string, order?: number, live = false): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(1),
    ...(order === undefined
      ? {}
      : {
          metadata: { sessionNodeCreatedOrder: order, ...(live ? { liveIncorporated: true } : {}) },
        }),
  }
}

function assistant(id: string, content: string): UIMessage {
  return { id, role: 'assistant', parts: [{ type: 'text', content }], createdAt: new Date(2) }
}

function summary(id: string): UIMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', content: 'Summary' }],
    createdAt: new Date(1),
    metadata: { compactionSummary: { summary: 'Summary', tokensBefore: 10 } },
  }
}

const ids = (messages: readonly UIMessage[]) => messages.map((message) => message.id)

describe('placeSeededRunMessages', () => {
  // The previous Run used the same prompt text, and is persisted under its Session node ids.
  const persisted = [user('n-u1', 'continue', 1), assistant('n-a1', 'Run 1 answer')]
  const seeded = [
    user('live-u2', 'continue', 5, true),
    assistant('b1', 'Reading'),
    assistant('b2', 'Found it'),
    assistant('b3', 'Writing'),
  ]

  it('puts a Run that repeats the previous prompt below the previous Run', () => {
    const placed = placeSeededRunMessages({
      persistedMessages: persisted,
      seededMessages: seeded,
      compactionStatus: null,
    })

    expect(ids(placed.messages)).toEqual(['n-u1', 'n-a1', 'live-u2', 'b1', 'b2', 'b3'])
  })

  it('keeps the order and shows each message once when the reconnect buffer then arrives', () => {
    const hydrated = placeSeededRunMessages({
      persistedMessages: persisted,
      seededMessages: seeded,
      compactionStatus: null,
    }).messages
    const reconnected = placeReconnectedRunMessages(
      persisted,
      {
        messageId: 'b3',
        userMessages: [
          {
            messageId: 'live-u2',
            parts: [{ type: 'text', text: 'continue' }],
            sessionNodeCreatedOrder: 5,
            timestamp: 3,
          },
        ],
      },
      assistant('b3', 'Writing the fix'),
    )

    expect(ids(mergeBackgroundReconnectMessages(reconnected, hydrated))).toEqual([
      'n-u1',
      'n-a1',
      'live-u2',
      'b1',
      'b2',
      'b3',
    ])
  })

  it('does not repeat a message the history already holds, by id or Session log order', () => {
    const placed = placeSeededRunMessages({
      persistedMessages: [...persisted, user('n-u2', 'continue', 5)],
      seededMessages: [assistant('n-a1', 'Run 1 answer'), ...seeded],
      compactionStatus: null,
    })

    expect(ids(placed.messages)).toEqual(['n-u1', 'n-a1', 'n-u2', 'b1', 'b2', 'b3'])
  })

  it('anchors a compaction recorded during the Run after the persisted history', () => {
    const runCompaction: AgentCompactionStatus = {
      type: 'completed',
      reason: 'threshold',
      summaryCountAtStart: 0,
      timeline: [
        {
          id: '9:0',
          phase: 'completed',
          reason: 'threshold',
          summaryCountAtStart: 0,
          expectedSummaryCount: 1,
          messageCountAtStart: 2,
        },
      ],
    }
    const history = [summary('n-s1'), ...persisted]

    const placed = placeSeededRunMessages({
      persistedMessages: history,
      seededMessages: seeded,
      compactionStatus: runCompaction,
    })

    expect(placed.compactionStatus).toEqual({
      ...runCompaction,
      summaryCountAtStart: 1,
      timeline: [
        {
          ...runCompaction.timeline[0],
          summaryCountAtStart: 1,
          expectedSummaryCount: 2,
          messageCountAtStart: history.length + 2,
        },
      ],
    })
    // The history's own summary does not acknowledge the Run's compaction.
    expect(acknowledgeCompactionStatus(placed.compactionStatus, ['n-s1'])).toMatchObject({
      timeline: [{ id: '9:0', messageCountAtStart: 5 }],
    })
  })

  it('counts only the Run messages it shows when moving a compaction anchor', () => {
    const placed = placeSeededRunMessages({
      persistedMessages: persisted,
      seededMessages: [assistant('n-a1', 'Run 1 answer'), ...seeded],
      compactionStatus: {
        type: 'retrying',
        attempt: 1,
        maxAttempts: 3,
        delayMs: 1000,
        errorMessage: 'overloaded',
        previousCompactionStatus: {
          type: 'compacting',
          reason: 'overflow',
          summaryCountAtStart: 0,
          timeline: [
            {
              id: '9:0',
              phase: 'running',
              reason: 'overflow',
              summaryCountAtStart: 0,
              messageCountAtStart: 3,
            },
          ],
        },
      },
    })

    expect(placed.compactionStatus).toMatchObject({
      type: 'retrying',
      previousCompactionStatus: { timeline: [{ messageCountAtStart: 4 }] },
    })
  })
})

describe('repeated prompt text in snapshot reconciliation', () => {
  it('never gives a prompt the identity of an earlier one at another Session log order', () => {
    const reconciled = reconcileSnapshotUserMessages(
      [user('n-u1', 'continue', 1), assistant('n-a1', 'Run 1'), user('n-u2', 'continue', 5)],
      [user('live-u2', 'continue', 5, true)],
    )

    expect(ids(reconciled)).toEqual(['n-u1', 'n-a1', 'live-u2'])
  })

  it('prefers the row at the same order over an optimistic send with the same text', () => {
    const reconciled = reconcileSnapshotUserMessages(
      [user('n-u2', 'continue', 5)],
      [user('optimistic', 'continue'), user('live-u2', 'continue', 5, true)],
    )

    expect(ids(reconciled)).toEqual(['live-u2'])
  })

  it('still gives an optimistic send the identity of its persisted prompt', () => {
    expect(
      ids(
        reconcileSnapshotUserMessages(
          [user('n-u2', 'continue', 5)],
          [user('optimistic', 'continue')],
        ),
      ),
    ).toEqual(['optimistic'])
  })
})
