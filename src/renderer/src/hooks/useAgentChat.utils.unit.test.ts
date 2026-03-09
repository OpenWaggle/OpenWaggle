import { ConversationId, MessageId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { describe, expect, it } from 'vitest'
import {
  conversationToUIMessages,
  formatAttachmentPreview,
  restorePersistedToolCallMetadata,
} from './useAgentChat.utils'

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
  it('preserves persisted approval metadata on tool-call parts', () => {
    const conversation: Conversation = {
      id: ConversationId('conv-1'),
      title: 'Pending approval',
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
                name: 'writeFile',
                args: { path: 'pending.txt' },
                state: 'approval-requested',
                approval: {
                  id: 'approval_tool-1',
                  needsApproval: true,
                },
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
      name: 'writeFile',
      arguments: '{"path":"pending.txt"}',
      state: 'approval-requested',
      approval: {
        id: 'approval_tool-1',
        needsApproval: true,
      },
    })
  })
})

describe('restorePersistedToolCallMetadata', () => {
  it('restores stripped tool-call approval metadata from the persisted conversation snapshot', () => {
    const conversation: Conversation = {
      id: ConversationId('conv-1'),
      title: 'Pending approval',
      projectPath: null,
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
                id: ToolCallId('tool-restore'),
                name: 'writeFile',
                args: { path: 'pending.txt' },
                state: 'approval-requested',
                approval: {
                  id: 'approval_tool-restore',
                  needsApproval: true,
                },
              },
            },
          ],
        },
      ],
    }

    const restoredMessages = restorePersistedToolCallMetadata(
      [
        {
          id: 'msg-1',
          role: 'assistant',
          createdAt: new Date(1),
          parts: [
            {
              type: 'tool-call',
              id: 'tool-restore-shadow',
              name: 'writeFile',
              arguments: '{"path":"pending.txt"}',
              state: 'input-complete',
            },
          ],
        },
      ],
      conversation,
    )

    expect(restoredMessages[0]?.parts[0]).toEqual({
      type: 'tool-call',
      id: 'tool-restore-shadow',
      name: 'writeFile',
      arguments: '{"path":"pending.txt"}',
      state: 'approval-requested',
      approval: {
        id: 'approval_tool-restore',
        needsApproval: true,
      },
    })
  })
})
