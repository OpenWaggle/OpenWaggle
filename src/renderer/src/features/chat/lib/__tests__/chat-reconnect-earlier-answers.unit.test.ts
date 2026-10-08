import type { BackgroundRunSnapshot, BackgroundRunUserMessage } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { placeReconnectedRunMessages } from '../chat-stream-user-messages'
import { earlierAnswersOf, partialAssistantOf } from '../reconnect-buffer-anchors'

function user(messageId: string, order: number, after?: string): BackgroundRunUserMessage {
  return {
    messageId,
    parts: [{ type: 'text', text: messageId }],
    sessionNodeCreatedOrder: order,
    timestamp: order * 10,
    ...(after ? { afterAssistantMessageId: after } : {}),
  }
}

function answer(messageId: string, timestamp: number) {
  return { messageId, timestamp, parts: [{ type: 'text' as const, text: messageId }] }
}

const SNAPSHOT: BackgroundRunSnapshot = {
  activity: 'agent-run',
  sessionId: SessionId('session-1'),
  model: SupportedModelId('claude-sonnet-4-5'),
  mode: 'classic',
  startedAt: 1,
  activityEvents: [],
  messageId: 'answer-3',
  messageStartedAt: 60,
  parts: [{ type: 'text', text: 'streaming' }],
}

const ids = (messages: readonly UIMessage[]) => messages.map((message) => message.id)

/*
 * A reconnect (a renderer reload mid-Run) places the Run's finished answers the buffer retains
 * among its user messages in the order Pi took them, before the answer still streaming.
 */
describe('placeReconnectedRunMessages with the Run earlier answers', () => {
  it('places each user message after the answer it followed, the leading ones first', () => {
    const snapshot: BackgroundRunSnapshot = {
      ...SNAPSHOT,
      assistantMessages: [answer('answer-1', 15), answer('answer-2', 35)],
      userMessages: [
        user('prompt', 1),
        user('steer-a', 2, 'answer-1'),
        user('steer-b', 5, 'answer-3'),
      ],
    }
    const placed = placeReconnectedRunMessages(
      [],
      snapshot,
      partialAssistantOf(snapshot),
      earlierAnswersOf(snapshot),
    )
    expect(ids(placed)).toEqual([
      'prompt',
      'answer-1',
      'steer-a',
      'answer-2',
      'answer-3',
      'steer-b',
    ])
    // Dated by Host time: when each started streaming.
    expect(placed.find((message) => message.id === 'answer-2')?.createdAt).toEqual(new Date(35))
    expect(placed.find((message) => message.id === 'answer-3')?.createdAt).toEqual(new Date(60))
  })

  it('places a user message whose answer the caps left out by Host time', () => {
    const snapshot: BackgroundRunSnapshot = {
      ...SNAPSHOT,
      assistantMessages: [answer('answer-1', 15), answer('answer-4', 45)],
      userMessages: [user('prompt', 1), user('steer-a', 3, 'answer-2')],
    }
    const placed = placeReconnectedRunMessages([], snapshot, null, earlierAnswersOf(snapshot))
    expect(ids(placed)).toEqual(['prompt', 'answer-1', 'steer-a', 'answer-4'])
  })

  it('places a user message taken the same millisecond an answer started before that answer', () => {
    const snapshot: BackgroundRunSnapshot = {
      ...SNAPSHOT,
      assistantMessages: [answer('answer-1', 15), answer('answer-4', 30)],
      userMessages: [user('prompt', 1), user('steer-a', 3, 'answer-2')],
    }
    const placed = placeReconnectedRunMessages([], snapshot, null, earlierAnswersOf(snapshot))
    expect(ids(placed)).toEqual(['prompt', 'answer-1', 'steer-a', 'answer-4'])
  })

  it('places the user messages alone from an older Host', () => {
    const snapshot: BackgroundRunSnapshot = { ...SNAPSHOT, userMessages: [user('prompt', 1)] }
    expect(earlierAnswersOf(snapshot)).toEqual([])
    expect(
      ids(placeReconnectedRunMessages([], snapshot, partialAssistantOf(snapshot), [])),
    ).toEqual(['prompt', 'answer-3'])
  })
})
