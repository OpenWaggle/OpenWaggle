import type { UIMessage } from '@shared/types/chat-ui'
import { describe, expect, it } from 'vitest'
import { retryableLastUserMessage } from '../retryable-last-user-message'

function message(
  id: string,
  role: UIMessage['role'],
  text: string,
  metadata?: UIMessage['metadata'],
) {
  return {
    id,
    role,
    parts: [{ type: 'text' as const, content: text }],
    ...(metadata ? { metadata } : {}),
  }
}

describe('retryableLastUserMessage', () => {
  it('offers the last user message to send again', () => {
    expect(
      retryableLastUserMessage([
        message('u1', 'user', 'Draft the epics'),
        message('a1', 'assistant', 'The Workers are drafting.'),
      ]),
    ).toBe('Draft the epics')
  })

  it('offers nothing when the failed Run was a Hive wake', () => {
    expect(
      retryableLastUserMessage([
        message('u1', 'user', 'Draft the epics'),
        message('a1', 'assistant', 'The Workers are drafting.'),
        message('wake-1', 'user', 'Worker updates arrived', { hiveWake: true }),
      ]),
    ).toBeNull()
  })
})
