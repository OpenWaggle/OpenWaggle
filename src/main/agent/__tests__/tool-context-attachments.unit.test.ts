import type { HydratedAgentSendPayload, HydratedAttachment, Message } from '@shared/types/agent'
import { ConversationId, MessageId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { describe, expect, it } from 'vitest'
import { resolveToolContextAttachments } from '../tool-context-attachments'

const TEST_TIMESTAMP = 1_700_000_000_000

function makeHydratedAttachment(name: string, extractedText: string): HydratedAttachment {
  return {
    id: `attachment-${name}`,
    kind: 'text',
    origin: 'auto-paste-text',
    name,
    path: `/tmp/${name}`,
    mimeType: 'text/markdown',
    sizeBytes: extractedText.length,
    extractedText,
    source: null,
  }
}

function makeUserMessage(id: string, parts: Message['parts']): Message {
  return {
    id: MessageId(id),
    role: 'user',
    parts,
    createdAt: TEST_TIMESTAMP,
  }
}

function makeConversation(messages: Message[]): Conversation {
  return {
    id: ConversationId('conversation-test'),
    title: 'Test',
    projectPath: '/tmp/project',
    messages,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
  }
}

function makePayload(attachments: readonly HydratedAttachment[]): HydratedAgentSendPayload {
  return {
    text: 'save it',
    qualityPreset: 'medium',
    attachments,
  }
}

describe('resolveToolContextAttachments', () => {
  it('prefers attachments from the current payload when present', () => {
    const previousAttachment = makeHydratedAttachment('Old.md', 'old')
    const currentAttachment = makeHydratedAttachment('Current.md', 'current')
    const conversation = makeConversation([
      makeUserMessage('user-1', [{ type: 'attachment', attachment: previousAttachment }]),
    ])
    const payload = makePayload([currentAttachment])

    const resolved = resolveToolContextAttachments(conversation, payload)

    expect(resolved).toEqual([{ name: 'Current.md', extractedText: 'current' }])
  })

  it('falls back to the latest user attachment message when payload has no attachments', () => {
    const oldAttachment = makeHydratedAttachment('Old.md', 'old')
    const latestAttachment = makeHydratedAttachment('Latest.md', 'latest')
    const conversation = makeConversation([
      makeUserMessage('user-2', [{ type: 'attachment', attachment: oldAttachment }]),
      {
        id: MessageId('assistant-1'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'What next?' }],
        createdAt: TEST_TIMESTAMP,
      },
      makeUserMessage('user-3', [{ type: 'attachment', attachment: latestAttachment }]),
    ])
    const payload = makePayload([])

    const resolved = resolveToolContextAttachments(conversation, payload)

    expect(resolved).toEqual([{ name: 'Latest.md', extractedText: 'latest' }])
  })

  it('returns an empty list when neither payload nor conversation has attachments', () => {
    const conversation = makeConversation([
      makeUserMessage('user-4', [{ type: 'text', text: 'hello' }]),
      {
        id: MessageId('assistant-2'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'hi' }],
        createdAt: TEST_TIMESTAMP,
      },
    ])
    const payload = makePayload([])

    const resolved = resolveToolContextAttachments(conversation, payload)

    expect(resolved).toEqual([])
  })
})
