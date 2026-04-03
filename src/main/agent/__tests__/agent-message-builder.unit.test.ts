import type { HydratedAgentSendPayload, HydratedAttachment, Message } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockConversationToMessages = vi.hoisted(() => vi.fn().mockReturnValue([]))

vi.mock('../message-mapper', () => ({
  conversationToMessages: mockConversationToMessages,
  microcompactMessages: vi.fn((msgs: unknown[]) => ({ messages: msgs, strippedCount: 0 })),
}))

import type { ProviderDefinition } from '../../providers/provider-definition'
import { buildFreshChatMessages, buildUserChatContent } from '../agent-message-builder'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => vi.clearAllMocks())

function makeProvider(
  supportsAttachmentFn: (kind: string) => boolean = () => false,
): ProviderDefinition {
  return {
    id: 'anthropic',
    displayName: 'Anthropic',
    requiresApiKey: true,
    supportsBaseUrl: false,
    supportsSubscription: false,
    supportsDynamicModelFetch: false,
    models: ['claude-sonnet-4-5'],
    testModel: 'claude-sonnet-4-5',
    supportsAttachment: supportsAttachmentFn,
    createAdapter: vi.fn(),
  }
}

function makePayload(
  text: string,
  attachments: readonly HydratedAttachment[] = [],
): HydratedAgentSendPayload {
  return {
    text,
    qualityPreset: 'medium',
    attachments,
  }
}

function makeImageAttachment(overrides: Partial<HydratedAttachment> = {}): HydratedAttachment {
  return {
    id: 'att-1',
    kind: 'image',
    name: 'screenshot.png',
    path: '/tmp/screenshot.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    extractedText: '',
    source: { type: 'data', value: 'base64data', mimeType: 'image/png' },
    ...overrides,
  }
}

function makePdfAttachment(overrides: Partial<HydratedAttachment> = {}): HydratedAttachment {
  return {
    id: 'att-2',
    kind: 'pdf',
    name: 'doc.pdf',
    path: '/tmp/doc.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    extractedText: '',
    source: { type: 'data', value: 'base64pdf', mimeType: 'application/pdf' },
    ...overrides,
  }
}

function makeConversation(messages: Message[] = []): Conversation {
  return {
    id: 'conv-1' as ConversationId,
    title: 'Test',
    projectPath: '/tmp/project',
    messages,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// buildUserChatContent
// ---------------------------------------------------------------------------

describe('buildUserChatContent', () => {
  it('returns plain string for text-only payload', () => {
    const provider = makeProvider()
    const payload = makePayload('Hello world')

    const result = buildUserChatContent(provider, payload)
    expect(result).toBe('Hello world')
  })

  it('trims whitespace from text', () => {
    const provider = makeProvider()
    const payload = makePayload('  spaced  ')

    const result = buildUserChatContent(provider, payload)
    expect(result).toBe('spaced')
  })

  it('returns empty string when no text and no attachments', () => {
    const provider = makeProvider()
    const payload = makePayload('  ')

    const result = buildUserChatContent(provider, payload)
    expect(result).toBe('')
  })

  it('returns array when text + image attachment with provider support', () => {
    const provider = makeProvider((kind) => kind === 'image')
    const attachment = makeImageAttachment()
    const payload = makePayload('Look at this', [attachment])

    const result = buildUserChatContent(provider, payload)
    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      // text part + image part + attachment summary text part
      expect(result.length).toBe(3)
      expect(result[0]).toEqual({ type: 'text', content: 'Look at this' })
      expect(result[1]).toEqual({
        type: 'image',
        source: { type: 'data', value: 'base64data', mimeType: 'image/png' },
      })
      expect(result[2]).toEqual({
        type: 'text',
        content: '[Attachment: screenshot.png] (no extractable text)',
      })
    }
  })

  it('includes extracted text in attachment summary', () => {
    const provider = makeProvider()
    const attachment = makeImageAttachment({
      extractedText: 'Some extracted content',
      source: null,
    })
    const payload = makePayload('Check this', [attachment])

    const result = buildUserChatContent(provider, payload)
    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      const summaryPart = result.find(
        (p) => p.type === 'text' && p.content.includes('[Attachment:'),
      )
      expect(summaryPart).toBeDefined()
      if (summaryPart && summaryPart.type === 'text') {
        expect(summaryPart.content).toContain('Some extracted content')
      }
    }
  })

  it('does not add image part when provider does not support the attachment kind', () => {
    const provider = makeProvider(() => false)
    const attachment = makeImageAttachment()
    const payload = makePayload('Look at this', [attachment])

    const result = buildUserChatContent(provider, payload)
    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      const imageParts = result.filter((p) => p.type === 'image')
      expect(imageParts).toHaveLength(0)
    }
  })

  it('returns array with document part for supported pdf attachment', () => {
    const provider = makeProvider((kind) => kind === 'pdf')
    const attachment = makePdfAttachment()
    const payload = makePayload('Read this doc', [attachment])

    const result = buildUserChatContent(provider, payload)
    expect(Array.isArray(result)).toBe(true)
    if (Array.isArray(result)) {
      const docParts = result.filter((p) => p.type === 'document')
      expect(docParts).toHaveLength(1)
    }
  })
})

// ---------------------------------------------------------------------------
// buildFreshChatMessages
// ---------------------------------------------------------------------------

describe('buildFreshChatMessages', () => {
  it('includes conversation history plus new user message', () => {
    const historyMessages = [
      { role: 'user' as const, content: 'prior question' },
      { role: 'assistant' as const, content: 'prior answer' },
    ]
    mockConversationToMessages.mockReturnValue(historyMessages)

    const conversation = makeConversation()
    const provider = makeProvider()
    const payload = makePayload('new question')

    const messages = buildFreshChatMessages(conversation, provider, payload)

    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual({ role: 'user', content: 'prior question' })
    expect(messages[1]).toEqual({ role: 'assistant', content: 'prior answer' })
    expect(messages[2]).toEqual({ role: 'user', content: 'new question' })
  })

  it('passes conversation.messages to conversationToMessages', () => {
    const conversation = makeConversation()
    const provider = makeProvider()
    const payload = makePayload('hello')

    buildFreshChatMessages(conversation, provider, payload)

    expect(mockConversationToMessages).toHaveBeenCalledWith(conversation.messages)
  })

  it('works with empty conversation history', () => {
    mockConversationToMessages.mockReturnValue([])

    const conversation = makeConversation()
    const provider = makeProvider()
    const payload = makePayload('first message')

    const messages = buildFreshChatMessages(conversation, provider, payload)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toEqual({ role: 'user', content: 'first message' })
  })
})
