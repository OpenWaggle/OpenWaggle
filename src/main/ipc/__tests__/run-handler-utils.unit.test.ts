import type { Message, PreparedAttachment } from '@shared/types/agent'
import { ConversationId, MessageId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepositoryError } from '../../errors'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'

const { emitTransportEventMock, updateTitleMock, hydrateAttachmentSourcesMock } = vi.hoisted(
  () => ({
    emitTransportEventMock: vi.fn(),
    updateTitleMock: vi.fn(),
    hydrateAttachmentSourcesMock: vi.fn(async () => [] as unknown[]),
  }),
)

vi.mock('../../utils/stream-bridge', () => ({
  emitErrorAndFinish(conversationId: unknown, message: string, code: string, runId = '') {
    emitTransportEventMock(conversationId, {
      type: 'agent_end',
      timestamp: Date.now(),
      runId,
      reason: 'error',
      error: { message, code },
    })
  },
}))

const makeTestConversationLayer = () =>
  Layer.succeed(SessionProjectionRepository, {
    get: (id) =>
      Effect.tryPromise({
        try: async () => makeConversation({ id }),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'get', cause }),
      }),
    getOptional: (id) =>
      Effect.tryPromise({
        try: async () => makeConversation({ id }),
        catch: (cause) => new SessionProjectionRepositoryError({ operation: 'getOptional', cause }),
      }),
    list: () => Effect.succeed([]),
    listFull: () => Effect.succeed([]),
    create: () => Effect.succeed(makeConversation()),
    delete: () => Effect.void,
    archive: () => Effect.void,
    unarchive: () => Effect.void,
    listArchived: () => Effect.succeed([]),
    updateTitle: (id, title) =>
      Effect.sync(() => {
        updateTitleMock(id, title)
      }),
  })

const TestRuntimeLayer = makeTestConversationLayer()

vi.mock('../../utils/attachment-hydration', () => ({
  hydrateAttachmentSources: hydrateAttachmentSourcesMock,
}))

import {
  assignSessionTitleFromUserText,
  emitErrorAndFinish,
  hydratePayloadAttachments,
} from '../run-handler-utils'

const CONV_ID = ConversationId('test-conv-id')

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: MessageId('m1'),
    role: 'user',
    parts: [{ type: 'text', text: 'Existing' }],
    createdAt: Date.now(),
    ...overrides,
  }
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV_ID,
    title: 'New session',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPath: '/test',
    ...overrides,
  }
}

function makeAttachment(overrides: Partial<PreparedAttachment> = {}): PreparedAttachment {
  return {
    id: 'a1',
    kind: 'text',
    name: 'test.txt',
    path: '/test.txt',
    mimeType: 'text/plain',
    sizeBytes: 100,
    extractedText: '',
    ...overrides,
  }
}

function runTitleAssignment(conversation: Conversation, text: string): Promise<string | null> {
  return Effect.runPromise(
    Effect.provide(assignSessionTitleFromUserText(CONV_ID, conversation, text), TestRuntimeLayer),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('emitErrorAndFinish', () => {
  it('emits an error terminal transport event', () => {
    emitErrorAndFinish(CONV_ID, 'Something broke', 'test-error')

    expect(emitTransportEventMock).toHaveBeenCalledTimes(1)

    const finishChunk = emitTransportEventMock.mock.calls[0]
    expect(finishChunk[0]).toBe(CONV_ID)
    expect(finishChunk[1].type).toBe('agent_end')
    expect(finishChunk[1].runId).toBe('')
    expect(finishChunk[1].reason).toBe('error')
    expect(finishChunk[1].error).toEqual({ message: 'Something broke', code: 'test-error' })
  })

  it('propagates optional runId', () => {
    emitErrorAndFinish(CONV_ID, 'Error', 'code', 'waggle-123')

    const finishChunk = emitTransportEventMock.mock.calls[0]
    expect(finishChunk[1].runId).toBe('waggle-123')
  })
})

describe('hydratePayloadAttachments', () => {
  it('delegates to hydrateAttachmentSources', async () => {
    const attachments = [makeAttachment()]
    const hydratedResult = [{ id: 'hydrated' }]
    hydrateAttachmentSourcesMock.mockResolvedValue(hydratedResult)

    const result = await hydratePayloadAttachments(attachments)

    expect(hydrateAttachmentSourcesMock).toHaveBeenCalledWith(attachments)
    expect(result).toBe(hydratedResult)
  })
})

describe('assignSessionTitleFromUserText', () => {
  it('assigns a deterministic title for a new session projection', async () => {
    const conv = makeConversation()
    const title = await runTitleAssignment(conv, 'Hello world')

    expect(title).toBe('Hello world')
    expect(updateTitleMock).toHaveBeenCalledWith(CONV_ID, 'Hello world')
  })

  it('skips when title is already set', async () => {
    const conv = makeConversation({ title: 'Existing title' })
    const title = await runTitleAssignment(conv, 'Hello world')

    expect(title).toBeNull()
    expect(updateTitleMock).not.toHaveBeenCalled()
  })

  it('skips when messages already exist', async () => {
    const conv = makeConversation({ messages: [makeMessage()] })
    const title = await runTitleAssignment(conv, 'Hello world')

    expect(title).toBeNull()
    expect(updateTitleMock).not.toHaveBeenCalled()
  })

  it('skips when text is empty or whitespace', async () => {
    const conv = makeConversation()
    const title = await runTitleAssignment(conv, '   ')

    expect(title).toBeNull()
    expect(updateTitleMock).not.toHaveBeenCalled()
  })
})
