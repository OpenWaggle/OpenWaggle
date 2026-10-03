import type { Message } from '@shared/types/agent'
import { MessageId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import {
  formatSessionTitleContext,
  type SessionTitleContextMessage,
  toSessionTitleContextMessage,
} from '../session-title-context'

function message(
  role: SessionTitleContextMessage['role'],
  text: string,
  attachments: SessionTitleContextMessage['attachments'] = [],
): SessionTitleContextMessage {
  return { role, text, attachments }
}

describe('formatSessionTitleContext', () => {
  it('keeps the conversation in order with role labels and drops system messages', () => {
    const context = formatSessionTitleContext([
      message('system', 'You are an agent.'),
      message('user', 'Fix this failing test.'),
      message('assistant', 'The lazy feed test expects a full body.'),
    ])

    expect(context.message).toBe(
      'USER:\nFix this failing test.\n\nASSISTANT:\nThe lazy feed test expects a full body.',
    )
  })

  it('keeps user intent when an assistant reply would exhaust the budget', () => {
    const context = formatSessionTitleContext([
      message('user', 'Improve QR sharing layout.'),
      message('user', 'Change of plan. Fix pairing token expiry.'),
      message('assistant', `The token expires early. ${'Detail. '.repeat(2_000)}`),
      message('user', 'Ship it.'),
    ])

    expect(context.message).toContain('Improve QR sharing layout.')
    expect(context.message).toContain('Change of plan. Fix pairing token expiry.')
    expect(context.message).toContain('Ship it.')
    expect(context.message.length).toBeLessThanOrEqual(8_000)
    expect(context.message.startsWith('[Earlier content truncated]')).toBe(true)
  })

  it('names attachments and keeps the first plus the most recent ones', () => {
    const attachment = (id: string) => ({ id, name: `${id}.png`, mimeType: 'image/png' })
    const context = formatSessionTitleContext([
      message('user', 'Look at this', [attachment('first')]),
      message('user', 'And these', ['a', 'b', 'c', 'd'].map(attachment)),
    ])

    expect(context.message).toContain('[Attachments: first.png]')
    expect(context.attachments.map((item) => item.id)).toEqual(['first', 'b', 'c', 'd'])
  })
})

describe('toSessionTitleContextMessage', () => {
  it('keeps text and attachments and drops reasoning and tool traces', () => {
    const source: Message = {
      id: MessageId('m1'),
      role: 'assistant',
      createdAt: 1,
      parts: [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'Answer' },
        {
          type: 'attachment',
          attachment: {
            id: 'a1',
            kind: 'image',
            name: 'shot.png',
            path: '/tmp/shot.png',
            mimeType: 'image/png',
            sizeBytes: 1,
            extractedText: '',
          },
        },
      ],
    }

    expect(toSessionTitleContextMessage(source)).toEqual({
      role: 'assistant',
      text: 'Answer',
      attachments: [{ id: 'a1', name: 'shot.png', mimeType: 'image/png' }],
    })
  })
})
