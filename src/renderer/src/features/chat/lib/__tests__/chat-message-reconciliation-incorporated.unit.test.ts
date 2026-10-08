import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { appendUnpersistedAssistantTail } from '../chat-message-reconciliation'

function userMessage(id: string, content: string): UIMessage {
  return { id, role: 'user', parts: [{ type: 'text', content }], createdAt: new Date(1) }
}

describe('appendUnpersistedAssistantTail with user rows Pi incorporated', () => {
  const at = (message: UIMessage, order: number): UIMessage => ({
    ...message,
    metadata: { sessionNodeCreatedOrder: order },
  })
  const prompt = at(userMessage('pi-user-1', 'fix it'), 1)
  const answer = at(
    { id: 'pi-answer-1', role: 'assistant', parts: [{ type: 'text', content: 'done' }] },
    2,
  )

  it('keeps a steer incorporated after all the saved Session holds: its save is still coming', () => {
    const steer = at(userMessage('live-steer-1', 'also the tests'), 3)
    expect(appendUnpersistedAssistantTail([prompt], [prompt, answer, steer])).toEqual([
      prompt,
      answer,
      steer,
    ])
  })

  it('drops a steer the saved Session holds later entries than: it was never saved', () => {
    const steer = at(userMessage('live-steer-1', 'also the tests'), 2)
    const later = at({ ...answer, id: 'pi-answer-2' }, 4)
    expect(appendUnpersistedAssistantTail([prompt, later], [prompt, later, steer])).toEqual([
      prompt,
      later,
    ])
  })
})
