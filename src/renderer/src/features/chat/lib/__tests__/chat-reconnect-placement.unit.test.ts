import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { mergeBackgroundReconnectMessages } from '../chat-reconnect-merge'

/*
 * What the merge knows besides the two lists: which reconnect messages precede the Run's own
 * (`earlierMessageIds`) and which answer each retained user message followed (`userMessageAnchors`).
 */

function message(
  id: string,
  role: UIMessage['role'],
  createdAt: number,
  order?: number,
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', content: id }],
    createdAt: new Date(createdAt),
    ...(order === undefined ? {} : { metadata: { sessionNodeCreatedOrder: order } }),
  }
}

const ids = (messages: readonly UIMessage[]) => messages.map((entry) => entry.id)

describe('mergeBackgroundReconnectMessages with Run context', () => {
  it('places a steer only the reconnect holds after the answer it followed', () => {
    const prompt = message('prompt', 'user', 1, 4)
    const steer = message('steer', 'user', 5, 8)
    const partial = message('a3', 'assistant', 9)
    expect(
      ids(
        mergeBackgroundReconnectMessages(
          [prompt, steer, partial],
          [prompt, message('a1', 'assistant', 2), message('a2', 'assistant', 6), partial],
          { userMessageAnchors: new Map([['steer', 'a1']]) },
        ),
      ),
    ).toEqual(['prompt', 'a1', 'steer', 'a2', 'a3'])
  })

  it('keeps the Run answers below the persisted Run and the prompt the transcript missed', () => {
    const history = message('p-u1', 'user', 1, 1)
    expect(
      ids(
        mergeBackgroundReconnectMessages(
          [history, message('p-a1', 'assistant', 2, 2), message('prompt', 'user', 3, 4)],
          [history, message('a1', 'assistant', 5)],
          { earlierMessageIds: new Set(['p-u1', 'p-a1', 'prompt']) },
        ),
      ),
    ).toEqual(['p-u1', 'p-a1', 'prompt', 'a1'])
  })

  it('places a steer whose answer is not shown above the answers received after it', () => {
    const prompt = message('prompt', 'user', 1, 4)
    expect(
      ids(
        mergeBackgroundReconnectMessages(
          [prompt, message('steer', 'user', 5, 9), message('a4', 'assistant', 9)],
          [prompt, message('a1', 'assistant', 2), message('a3', 'assistant', 7)],
          { userMessageAnchors: new Map([['steer', 'a2']]) },
        ),
      ),
    ).toEqual(['prompt', 'a1', 'steer', 'a3', 'a4'])
  })
})
