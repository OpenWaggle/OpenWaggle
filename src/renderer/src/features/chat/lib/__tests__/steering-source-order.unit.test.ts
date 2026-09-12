import { MessageId, SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { sessionToUIMessages } from '../chat-message-conversion'
import { reconcileSnapshotUserMessages } from '../chat-message-reconciliation'
import { mergeBackgroundReconnectMessages } from '../chat-reconnect-merge'

function userMessage(id: string, order?: number): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content: 'continue' }],
    createdAt: new Date(1),
    ...(order === undefined ? {} : { metadata: { sessionNodeCreatedOrder: order } }),
  }
}

describe('steering source order across renderer snapshots', () => {
  it('preserves zero and later native entry orders during session conversion', () => {
    const session: SessionDetail = {
      id: SessionId('source-order-session'),
      title: 'Steering receipt',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 1,
      messages: [0, 4].map((order) => ({
        id: MessageId(`source-${order}`),
        role: 'user',
        parts: [{ type: 'text', text: 'continue' }],
        createdAt: 1,
        metadata: { sessionNodeCreatedOrder: order },
      })),
    }

    expect(sessionToUIMessages(session).map((message) => message.metadata)).toEqual([
      { sessionNodeCreatedOrder: 0 },
      { sessionNodeCreatedOrder: 4 },
    ])
  })

  it('keeps optimistic React IDs while carrying each duplicate source order', () => {
    const optimistic = [userMessage('optimistic-original'), userMessage('optimistic-steer')]
    const result = reconcileSnapshotUserMessages(
      [userMessage('source-original', 2), userMessage('source-steer', 4)],
      optimistic,
    )

    expect(
      result.map((message) => [message.id, message.metadata?.sessionNodeCreatedOrder]),
    ).toEqual([
      ['optimistic-original', 2],
      ['optimistic-steer', 4],
    ])
    expect(optimistic.every((message) => message.metadata === undefined)).toBe(true)
  })

  it('retains the authoritative order when reconnect keeps an existing row', () => {
    const current = userMessage('source-steer')
    const result = mergeBackgroundReconnectMessages([userMessage('source-steer', 4)], [current])

    expect(result).toEqual([{ ...current, metadata: { sessionNodeCreatedOrder: 4 } }])
    expect(current.metadata).toBeUndefined()
  })

  it('does not invent an authoritative order for snapshots without one', () => {
    const current = userMessage('optimistic-steer')
    expect(reconcileSnapshotUserMessages([userMessage('source-steer')], [current])).toEqual([
      current,
    ])
  })
})
