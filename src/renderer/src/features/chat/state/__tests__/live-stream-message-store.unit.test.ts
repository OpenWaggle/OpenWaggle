import { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  liveMessageIsAhead,
  publishLiveStreamMessage,
  releaseLiveStreamMessage,
  resetLiveStreamMessages,
  withLiveStreamMessages,
} from '../live-stream-message-store'

const SESSION = SessionId('session-live')

function answer(text: string, thinking = ''): UIMessage {
  return {
    id: 'answer',
    role: 'assistant',
    parts: [
      { type: 'thinking', content: thinking, stepId: 'answer:thinking:0' },
      { type: 'text', content: text },
    ],
  }
}

describe('live stream messages', () => {
  afterEach(() => {
    resetLiveStreamMessages()
    vi.useRealTimers()
  })

  it('is ahead only while it lengthens the shown text', () => {
    expect(liveMessageIsAhead(answer('Hello there'), answer('Hello'))).toBe(true)
    expect(liveMessageIsAhead(answer('Hello', 'mulling'), answer('Hello', 'mull'))).toBe(true)
    // State caught up, or moved on: what it holds wins.
    expect(liveMessageIsAhead(answer('Hello'), answer('Hello'))).toBe(false)
    expect(liveMessageIsAhead(answer('Hel'), answer('Hello'))).toBe(false)
    expect(liveMessageIsAhead(answer('Goodbye world'), answer('Hello'))).toBe(false)
    // A part was added since: the shown message has the newer shape.
    const withTool: UIMessage = {
      ...answer('Hello'),
      parts: [
        ...answer('Hello').parts,
        { type: 'tool-call', id: 'call', name: 'read', arguments: '{}', state: 'input-available' },
      ],
    }
    expect(liveMessageIsAhead(answer('Hello there'), withTool)).toBe(false)
  })

  it('overlays the live copy on the messages it is ahead of', () => {
    const shown = [answer('Hello')]
    publishLiveStreamMessage(SESSION, answer('Hello there'))

    expect(withLiveStreamMessages(SESSION, shown)).toEqual([answer('Hello there')])
    expect(withLiveStreamMessages(SessionId('other'), shown)).toBe(shown)
  })

  it('releases a settled message after the current task, unless another one replaced it', () => {
    vi.useFakeTimers()
    publishLiveStreamMessage(SESSION, answer('Hello there'))
    releaseLiveStreamMessage(SESSION)
    expect(withLiveStreamMessages(SESSION, [answer('Hello')])).toEqual([answer('Hello there')])
    vi.runAllTimers()
    expect(withLiveStreamMessages(SESSION, [answer('Hello')])).toEqual([answer('Hello')])

    publishLiveStreamMessage(SESSION, answer('Hello there'))
    releaseLiveStreamMessage(SESSION)
    publishLiveStreamMessage(SESSION, answer('Hello there, again'))
    vi.runAllTimers()
    expect(withLiveStreamMessages(SESSION, [answer('Hello')])).toEqual([
      answer('Hello there, again'),
    ])
  })
})
