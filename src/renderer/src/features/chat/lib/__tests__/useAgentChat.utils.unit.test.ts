import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail } from '@shared/types/session'
import { describe, expect, it } from 'vitest'
import { registerAttachmentPreviewUrls } from '@/shared/lib/attachment-preview-urls'
import {
  appendMissingOptimisticUserMessages,
  appendUnpersistedAssistantTail,
  createOptimisticUserMessage,
  formatAttachmentPreview,
  mergeBackgroundReconnectMessages,
  reconcileSnapshotUserMessages,
  sessionToUIMessages,
} from '../useAgentChat.utils'

const LONG_TEXT = 'x'.repeat(400)
const REGULAR_ATTACHMENT_NAME = 'notes.md'
const AUTO_ATTACHMENT_NAME = 'Pasted Text 1.md'

function userMessage(id: string, content: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date(1),
  }
}

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

describe('appendMissingOptimisticUserMessages', () => {
  it('appends optimistic user messages that are absent from the persisted snapshot', () => {
    const snapshotMessages = [userMessage('persisted-1', 'already persisted')]
    const optimisticMessages = [
      userMessage('optimistic-1', 'already persisted'),
      userMessage('optimistic-2', 'still missing'),
    ]

    expect(appendMissingOptimisticUserMessages(snapshotMessages, optimisticMessages)).toEqual([
      ...snapshotMessages,
      optimisticMessages[1],
    ])
  })

  it('consumes persisted duplicate counts before appending extra optimistic duplicates', () => {
    const snapshotMessages = [
      userMessage('persisted-1', 'repeat'),
      userMessage('persisted-2', 'repeat'),
    ]
    const optimisticMessages = [
      userMessage('optimistic-1', 'repeat'),
      userMessage('optimistic-2', 'repeat'),
      userMessage('optimistic-3', 'repeat'),
    ]

    expect(appendMissingOptimisticUserMessages(snapshotMessages, optimisticMessages)).toEqual([
      ...snapshotMessages,
      optimisticMessages[2],
    ])
  })

  it('reconciles an image send as one user row while retaining its immediate preview', () => {
    const attachment = {
      id: 'image-1',
      kind: 'image' as const,
      origin: 'user-file' as const,
      name: 'screenshot.png',
      path: '/tmp/screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      extractedText: '',
    }
    registerAttachmentPreviewUrls(
      [attachment],
      [new File(['test'], attachment.name, { type: attachment.mimeType })],
    )
    const optimistic = createOptimisticUserMessage({
      text: 'Fix this layout',
      thinkingLevel: 'medium',
      attachments: [attachment],
    })
    const persisted = sessionToUIMessages({
      id: SessionId('session-image'),
      title: 'Image',
      projectPath: '/repo',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: MessageId('durable-image-message'),
          role: 'user',
          createdAt: 2,
          parts: [
            { type: 'text', text: 'Fix this layout' },
            { type: 'attachment', attachment },
          ],
        },
      ],
    })

    const snapshot = appendMissingOptimisticUserMessages(persisted, [optimistic])
    const reconciled = reconcileSnapshotUserMessages(snapshot, [optimistic])

    expect(snapshot).toHaveLength(1)
    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]?.id).toBe(optimistic.id)
    expect(reconciled[0]?.metadata?.sessionNodeId).toBe('durable-image-message')
    expect(reconciled[0]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image', name: 'screenshot.png' }),
        { type: 'text', content: 'Fix this layout' },
        { type: 'text', content: '[Attachment] screenshot.png' },
      ]),
    )
  })

  it('inserts an older missing optimistic turn before a newer replacement snapshot', () => {
    const olderOptimistic = {
      ...userMessage('optimistic-older', 'Explain the visualization'),
      createdAt: new Date(10),
    }
    const replacementMessages: UIMessage[] = [
      {
        ...userMessage('replacement-user', 'What did I select?'),
        createdAt: new Date(20),
      },
      {
        id: 'replacement-assistant',
        role: 'assistant',
        parts: [{ type: 'text', content: 'You selected sandbox.' }],
        createdAt: new Date(21),
      },
    ]

    expect(appendMissingOptimisticUserMessages(replacementMessages, [olderOptimistic])).toEqual([
      olderOptimistic,
      ...replacementMessages,
    ])
  })
})

describe('appendUnpersistedAssistantTail', () => {
  it('preserves live assistant output after a matching refreshed user snapshot', () => {
    const snapshotMessages = [userMessage('optimistic-user-1', 'review prototypes')]
    const liveAssistant: UIMessage = {
      id: 'assistant-live-1',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Partial answer' }],
      createdAt: new Date(2),
    }

    expect(
      appendUnpersistedAssistantTail(snapshotMessages, [
        userMessage('optimistic-user-1', 'review prototypes'),
        liveAssistant,
      ]),
    ).toEqual([...snapshotMessages, liveAssistant])
  })

  it('does not append stale live output once the refreshed snapshot has a different assistant', () => {
    const snapshotMessages = [
      userMessage('optimistic-user-1', 'review prototypes'),
      {
        id: 'assistant-persisted-1',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Persisted answer' }],
        createdAt: new Date(2),
      } satisfies UIMessage,
    ]
    const staleLiveAssistant: UIMessage = {
      id: 'assistant-live-1',
      role: 'assistant',
      parts: [{ type: 'text', content: 'Partial answer' }],
      createdAt: new Date(2),
    }

    expect(
      appendUnpersistedAssistantTail(snapshotMessages, [
        userMessage('optimistic-user-1', 'review prototypes'),
        staleLiveAssistant,
      ]),
    ).toEqual(snapshotMessages)
  })
})

describe('mergeBackgroundReconnectMessages', () => {
  it('does not duplicate an optimistic user message already present in the reconnect snapshot', () => {
    const persistedUser = userMessage('persisted-user-1', 'Draft a one-page summary of this app')
    const optimisticUser = userMessage('optimistic-user-1', 'Draft a one-page summary of this app')
    const cachedAssistant: UIMessage = {
      id: 'assistant-live-1',
      role: 'assistant',
      parts: [{ type: 'thinking', content: 'Inspecting implementation files' }],
      createdAt: new Date(2),
    }

    expect(
      mergeBackgroundReconnectMessages([persistedUser], [optimisticUser, cachedAssistant]),
    ).toEqual([persistedUser, cachedAssistant])
  })
})

describe('sessionToUIMessages', () => {
  it('preserves persisted tool-call state on tool-call parts', () => {
    const session: SessionDetail = {
      id: SessionId('session-1'),
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

    const messages = sessionToUIMessages(session)
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
    const session: SessionDetail = {
      id: SessionId('session-reasoning'),
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

    const messages = sessionToUIMessages(session)

    expect(messages[0]?.parts).toEqual([
      {
        type: 'thinking',
        content: 'Need to inspect the file first.',
      },
    ])
  })
})
