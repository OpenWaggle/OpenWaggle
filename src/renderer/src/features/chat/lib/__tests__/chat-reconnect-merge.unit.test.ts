import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { mergeBackgroundReconnectMessages } from '../chat-reconnect-merge'

function userMessage(id: string, content: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', content }], createdAt: new Date(1) }
}

describe('mergeBackgroundReconnectMessages placement of cached-only messages', () => {
  it('keeps answers streamed while the Session was hidden above the answer still streaming', () => {
    const assistant = (id: string, content: string): UIMessage => ({
      id,
      role: 'assistant',
      parts: [{ type: 'text', content }],
      createdAt: new Date(2),
    })
    const prompt = userMessage('live-user-1', 'Fix the transcript')

    expect(
      mergeBackgroundReconnectMessages(
        [prompt, assistant('assistant-3', 'Writing')],
        [
          prompt,
          assistant('assistant-1', 'Reading'),
          assistant('assistant-2', 'Found it'),
          assistant('assistant-3', 'Writing the fix'),
        ],
      ).map((message) => message.id),
    ).toEqual(['live-user-1', 'assistant-1', 'assistant-2', 'assistant-3'])
  })

  it('keeps messages before the first shared one above it, not below the streaming answer', () => {
    const assistant = (id: string): UIMessage => ({
      id,
      role: 'assistant',
      parts: [{ type: 'text', content: id }],
      createdAt: new Date(2),
    })

    expect(
      mergeBackgroundReconnectMessages(
        [userMessage('s1', 'Prompt'), assistant('partial')],
        [assistant('A'), userMessage('s1', 'Prompt'), assistant('B')],
      ).map((message) => message.id),
    ).toEqual(['A', 's1', 'B', 'partial'])
  })

  it('keeps a prompt the Session log recorded at another order despite repeated text', () => {
    const recorded = (id: string, order: number): UIMessage => ({
      ...userMessage(id, 'continue'),
      metadata: { sessionNodeCreatedOrder: order },
    })

    expect(
      mergeBackgroundReconnectMessages(
        [recorded('n-u1', 1)],
        [recorded('n-u1', 1), recorded('live-u2', 5)],
      ).map((message) => message.id),
    ).toEqual(['n-u1', 'live-u2'])
  })

  it('places a long transcript', () => {
    // 20,000 shared messages, each followed by one only the cached transcript holds. The size keeps
    // a quadratic placement (findIndex + splice per message) slow enough to fail the test timeout.
    const shared: UIMessage[] = []
    const current: UIMessage[] = []
    for (let index = 0; index < 20_000; index += 1) {
      const message: UIMessage = {
        id: `shared-${String(index)}`,
        role: 'assistant',
        parts: [],
        createdAt: new Date(2),
      }
      shared.push(message)
      current.push(message, { ...message, id: `cached-${String(index)}` })
    }

    const merged = mergeBackgroundReconnectMessages(shared, current)

    expect(merged.map((message) => message.id)).toEqual(current.map((message) => message.id))
  })
})

describe("mergeBackgroundReconnectMessages of an answer's parts", () => {
  const answer = (parts: UIMessage['parts']): UIMessage => ({ id: 'a1', role: 'assistant', parts })
  const merge = (buffered: UIMessage['parts'], shown: UIMessage['parts']) =>
    mergeBackgroundReconnectMessages([answer(buffered)], [answer(shown)])[0]?.parts

  it('keeps each text segment around a tool call, though one contains the other', () => {
    const parts: UIMessage['parts'] = [
      { type: 'text', content: 'I will run the tests, then report.' },
      { type: 'tool-call', id: 'call-1', name: 'bash', arguments: '{}', state: 'complete' },
      { type: 'text', content: 'report.' },
    ]
    expect(merge(parts, parts)).toEqual(parts)
  })
})
