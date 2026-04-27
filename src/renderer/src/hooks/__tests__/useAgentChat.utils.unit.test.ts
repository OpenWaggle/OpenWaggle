import { ConversationId, MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { describe, expect, it } from 'vitest'
import { conversationToUIMessages, formatAttachmentPreview } from '../useAgentChat.utils'

const LONG_TEXT = 'x'.repeat(400)
const REGULAR_ATTACHMENT_NAME = 'notes.md'
const AUTO_ATTACHMENT_NAME = 'Pasted Text 1.md'

describe('formatAttachmentPreview', () => {
  it('shows only attachment label for auto-converted long prompt files', () => {
    const preview = formatAttachmentPreview({
      name: AUTO_ATTACHMENT_NAME,
      extractedText: LONG_TEXT,
      origin: 'auto-paste-text',
    })
    expect(preview).toBe('[Attachment] Pasted Text 1.md')
  })

  it('clips regular attachment previews to max length', () => {
    const preview = formatAttachmentPreview({
      name: REGULAR_ATTACHMENT_NAME,
      extractedText: LONG_TEXT,
      origin: 'user-file',
    })
    expect(preview).toBe(`[Attachment] ${REGULAR_ATTACHMENT_NAME}\n${LONG_TEXT.slice(0, 320)}...`)
  })

  it('shows only attachment label when extracted text is empty', () => {
    const preview = formatAttachmentPreview({
      name: REGULAR_ATTACHMENT_NAME,
      extractedText: '   ',
      origin: 'user-file',
    })
    expect(preview).toBe(`[Attachment] ${REGULAR_ATTACHMENT_NAME}`)
  })
})

describe('conversationToUIMessages', () => {
  it('preserves persisted tool-call state on tool-call parts', () => {
    const conversation: Conversation = {
      id: ConversationId('conv-1'),
      title: 'Pending tool',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-1'),
          role: 'assistant',
          createdAt: 1,
          parts: [
            {
              type: 'tool-call',
              toolCall: {
                id: ToolCallId('tool-1'),
                name: 'write',
                args: { path: 'pending.txt' },
                state: 'input-complete',
              },
            },
          ],
        },
      ],
    }

    const messages = conversationToUIMessages(conversation)
    const toolCall = messages[0]?.parts[0]

    expect(toolCall).toEqual({
      type: 'tool-call',
      id: 'tool-1',
      name: 'write',
      arguments: '{"path":"pending.txt"}',
      state: 'input-complete',
    })
  })

  it('maps persisted reasoning parts to inline thinking UI parts', () => {
    const conversation: Conversation = {
      id: ConversationId('conv-reasoning'),
      title: 'Reasoning',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 1,
      messages: [
        {
          id: MessageId('msg-reasoning'),
          role: 'assistant',
          createdAt: 1,
          parts: [{ type: 'reasoning', text: 'Need to inspect the file first.' }],
        },
      ],
    }

    const messages = conversationToUIMessages(conversation)

    expect(messages[0]?.parts).toEqual([
      {
        type: 'thinking',
        content: 'Need to inspect the file first.',
      },
    ])
  })
})
