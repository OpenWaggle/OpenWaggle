import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { retainSnapshotMessageOrder } from '../chat-message-reconciliation'
import { mergeBackgroundReconnectMessages } from '../chat-reconnect-merge'
import { placeReconnectedRunMessages } from '../chat-stream-user-messages'

const DIGEST = 'a'.repeat(64)

function userRow(id: string, metadata?: UIMessage['metadata']): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content: 'Queued question' }],
    createdAt: new Date(1),
    ...(metadata ? { metadata } : {}),
  }
}

describe('live incorporated rows in snapshot reconciliation', () => {
  it('never takes a live row stream id as the Session node id', () => {
    const live = userRow('stream-id', {
      sessionNodeCreatedOrder: 4,
      durableTextSha256: DIGEST,
      liveIncorporated: true,
    })

    expect(retainSnapshotMessageOrder(userRow('optimistic-user-1'), live).metadata).toEqual({
      sessionNodeCreatedOrder: 4,
      durableTextSha256: DIGEST,
      liveIncorporated: true,
    })
  })

  it('keeps a node id the row already has when the snapshot row is live', () => {
    const current = userRow('optimistic-user-1', { sessionNodeId: 'node-4' })
    const live = userRow('stream-id', { sessionNodeCreatedOrder: 4, liveIncorporated: true })

    expect(retainSnapshotMessageOrder(current, live).metadata).toEqual({
      sessionNodeId: 'node-4',
      sessionNodeCreatedOrder: 4,
    })
  })

  it('takes the persisted node id and drops the live marker once the node is persisted', () => {
    const live = userRow('stream-id', { sessionNodeCreatedOrder: 4, liveIncorporated: true })

    expect(
      retainSnapshotMessageOrder(live, userRow('node-4', { sessionNodeCreatedOrder: 4 })),
    ).toMatchObject({ id: 'stream-id', metadata: { sessionNodeId: 'node-4' } })
    expect(
      retainSnapshotMessageOrder(live, userRow('node-4', { sessionNodeCreatedOrder: 4 })).metadata,
    ).not.toHaveProperty('liveIncorporated')
  })

  it('reconnects without giving the shown row a stream id as its node', () => {
    const shown = userRow('optimistic-user-1')
    const reconnected = placeReconnectedRunMessages(
      [],
      {
        messageId: 'assistant-2',
        userMessages: [
          {
            messageId: 'stream-id',
            parts: [{ type: 'text', text: 'Queued question' }],
            sessionNodeCreatedOrder: 4,
            durableTextSha256: DIGEST,
            timestamp: 3,
          },
        ],
      },
      null,
    )

    const [merged] = mergeBackgroundReconnectMessages(reconnected, [shown])

    expect(merged).toMatchObject({ id: 'optimistic-user-1' })
    expect(merged?.metadata).toEqual({
      sessionNodeCreatedOrder: 4,
      durableTextSha256: DIGEST,
      liveIncorporated: true,
    })
  })
})
