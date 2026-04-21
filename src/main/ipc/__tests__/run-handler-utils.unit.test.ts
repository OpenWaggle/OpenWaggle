import type { AgentSendPayload, PreparedAttachment } from '@shared/types/agent'
import { ConversationId, MessageId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationRepositoryError } from '../../errors'
import { ConversationRepository } from '../../ports/conversation-repository'
import { ProviderService } from '../../ports/provider-service'

const {
  emitStreamChunkMock,
  getConversationMock,
  saveConversationMock,
  withConversationLockMock,
  buildPersistedUserMessagePartsMock,
  makeMessageMock,
  generateTitleMock,
  hydrateAttachmentSourcesMock,
} = vi.hoisted(() => ({
  emitStreamChunkMock: vi.fn(),
  getConversationMock: vi.fn(),
  saveConversationMock: vi.fn(),
  withConversationLockMock: vi.fn(),
  buildPersistedUserMessagePartsMock: vi.fn(() => [{ type: 'text', text: 'test' }]),
  makeMessageMock: vi.fn(
    (role: string, parts: unknown[]) =>
      ({ id: 'msg-mock', role, parts, createdAt: Date.now() }) as unknown,
  ),
  generateTitleMock: vi.fn(),
  hydrateAttachmentSourcesMock: vi.fn(async () => [] as unknown[]),
}))

vi.mock('../../utils/stream-bridge', () => ({
  emitStreamChunk: emitStreamChunkMock,
  emitErrorAndFinish(conversationId: unknown, message: string, code: string, runId = '') {
    emitStreamChunkMock(conversationId, {
      type: 'RUN_ERROR',
      timestamp: Date.now(),
      error: { message, code },
    })
    emitStreamChunkMock(conversationId, {
      type: 'RUN_FINISHED',
      timestamp: Date.now(),
      runId,
      finishReason: 'stop',
    })
  },
}))

// Mock the Effect runtime to use a test ConversationRepository layer
const makeTestConversationLayer = () =>
  Layer.succeed(ConversationRepository, {
    get: (id) =>
      Effect.tryPromise({
        try: async () => getConversationMock(id),
        catch: (cause) => new ConversationRepositoryError({ operation: 'get', cause }),
      }),
    save: (conv) =>
      Effect.tryPromise({
        try: async () => {
          await saveConversationMock(conv)
        },
        catch: (cause) => new ConversationRepositoryError({ operation: 'save', cause }),
      }),
    list: () => Effect.succeed([]),
    listFull: () => Effect.succeed([]),
    create: () => Effect.succeed({} as never),
    delete: () => Effect.void,
    archive: () => Effect.void,
    unarchive: () => Effect.void,
    listArchived: () => Effect.succeed([]),
    updateTitle: () => Effect.void,
    updateProjectPath: () => Effect.void,
    updatePlanMode: () => Effect.void,
    updateCompactionGuidance: () => Effect.void,
    markMessagesAsCompacted: () => Effect.void,
  })

const TestProviderLayer = Layer.succeed(ProviderService, {
  get: () => Effect.succeed(undefined),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.succeed({} as never),
  isKnownModel: () => Effect.succeed(true),
  createChatAdapter: () => Effect.succeed({} as never),
  indexModels: () => Effect.void,
  fetchModels: () => Effect.succeed([]),
})

const TestRuntimeLayer = Layer.mergeAll(makeTestConversationLayer(), TestProviderLayer)

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown>) =>
    Effect.runPromise(Effect.provide(effect, TestRuntimeLayer)),
}))

vi.mock('../../agent/shared', () => ({
  buildPersistedUserMessageParts: buildPersistedUserMessagePartsMock,
  makeMessage: makeMessageMock,
}))

vi.mock('../../agent/title-generator', () => ({
  generateTitle: generateTitleMock,
}))

vi.mock('../attachments-handler', () => ({
  hydrateAttachmentSources: hydrateAttachmentSourcesMock,
}))

import {
  emitErrorAndFinish,
  hasPersistableUserInput,
  hydratePayloadAttachments,
  maybeTriggerTitleGeneration,
  persistUserMessageOnFailure,
} from '../run-handler-utils'

const CONV_ID = ConversationId('test-conv-id')

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: CONV_ID,
    title: 'New thread',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPath: '/test',
    ...overrides,
  }
}

function makePayload(overrides: Partial<AgentSendPayload> = {}): AgentSendPayload {
  return {
    text: '',
    qualityPreset: 'medium',
    attachments: [],
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

beforeEach(() => {
  vi.clearAllMocks()
  withConversationLockMock.mockImplementation(async (_id: unknown, fn: () => Promise<void>) => fn())
})

describe('emitErrorAndFinish', () => {
  it('emits RUN_ERROR followed by RUN_FINISHED', () => {
    emitErrorAndFinish(CONV_ID, 'Something broke', 'test-error')

    expect(emitStreamChunkMock).toHaveBeenCalledTimes(2)

    const errorChunk = emitStreamChunkMock.mock.calls[0]
    expect(errorChunk[0]).toBe(CONV_ID)
    expect(errorChunk[1].type).toBe('RUN_ERROR')
    expect(errorChunk[1].error).toEqual({ message: 'Something broke', code: 'test-error' })

    const finishChunk = emitStreamChunkMock.mock.calls[1]
    expect(finishChunk[0]).toBe(CONV_ID)
    expect(finishChunk[1].type).toBe('RUN_FINISHED')
    expect(finishChunk[1].runId).toBe('')
    expect(finishChunk[1].finishReason).toBe('stop')
  })

  it('propagates optional runId', () => {
    emitErrorAndFinish(CONV_ID, 'Error', 'code', 'waggle-123')

    const finishChunk = emitStreamChunkMock.mock.calls[1]
    expect(finishChunk[1].runId).toBe('waggle-123')
  })
})

describe('hasPersistableUserInput', () => {
  it('returns false for empty text and no attachments', () => {
    expect(hasPersistableUserInput(makePayload())).toBe(false)
  })

  it('returns false for whitespace-only text and no attachments', () => {
    expect(hasPersistableUserInput(makePayload({ text: '   ' }))).toBe(false)
  })

  it('returns true for non-empty text', () => {
    expect(hasPersistableUserInput(makePayload({ text: 'hello' }))).toBe(true)
  })

  it('returns true when attachments are present', () => {
    expect(hasPersistableUserInput(makePayload({ attachments: [makeAttachment()] }))).toBe(true)
  })
})

describe('persistUserMessageOnFailure', () => {
  it('persists user message when input is non-empty', async () => {
    const conv = makeConversation()
    getConversationMock.mockResolvedValue(conv)

    await persistUserMessageOnFailure(CONV_ID, makePayload({ text: 'hello' }))

    expect(makeMessageMock).toHaveBeenCalledOnce()
    expect(saveConversationMock).toHaveBeenCalledOnce()
  })

  it('skips persistence when input is empty', async () => {
    await persistUserMessageOnFailure(CONV_ID, makePayload())

    expect(saveConversationMock).not.toHaveBeenCalled()
  })

  it('skips persistence when conversation is not found', async () => {
    getConversationMock.mockResolvedValue(null)

    await persistUserMessageOnFailure(CONV_ID, makePayload({ text: 'hello' }))

    expect(saveConversationMock).not.toHaveBeenCalled()
  })

  it('respects messageCountGuard option', async () => {
    const conv = makeConversation({ messages: [{ id: MessageId('m1') } as never] })
    getConversationMock.mockResolvedValue(conv)

    // Guard is 0, but conversation already has 1 message → skip
    await persistUserMessageOnFailure(CONV_ID, makePayload({ text: 'hello' }), {
      messageCountGuard: 0,
    })

    expect(saveConversationMock).not.toHaveBeenCalled()
  })

  it('allows persistence when message count is within guard', async () => {
    const conv = makeConversation({ messages: [] })
    getConversationMock.mockResolvedValue(conv)

    await persistUserMessageOnFailure(CONV_ID, makePayload({ text: 'hello' }), {
      messageCountGuard: 5,
    })

    expect(saveConversationMock).toHaveBeenCalledOnce()
  })
})

describe('hydratePayloadAttachments', () => {
  it('delegates to hydrateAttachmentSources', async () => {
    const attachments = [makeAttachment()]
    const hydratedResult = [{ id: 'hydrated' }] as unknown[]
    hydrateAttachmentSourcesMock.mockResolvedValue(hydratedResult)

    const result = await hydratePayloadAttachments(attachments)

    expect(hydrateAttachmentSourcesMock).toHaveBeenCalledWith(attachments)
    expect(result).toBe(hydratedResult)
  })
})

describe('maybeTriggerTitleGeneration', () => {
  const mockChatStream = vi.fn()

  it('calls generateTitle for new thread with no messages and non-empty text', async () => {
    const conv = makeConversation()
    maybeTriggerTitleGeneration(CONV_ID, conv, 'Hello world', DEFAULT_SETTINGS, mockChatStream)

    // maybeTriggerTitleGeneration is fire-and-forget (void runAppEffect) —
    // await microtasks so the async Effect resolves before assertions.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(generateTitleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: CONV_ID,
        userText: 'Hello world',
      }),
    )
  })

  it('skips when title is already set', () => {
    const conv = makeConversation({ title: 'Existing title' })
    maybeTriggerTitleGeneration(CONV_ID, conv, 'Hello world', DEFAULT_SETTINGS, mockChatStream)

    expect(generateTitleMock).not.toHaveBeenCalled()
  })

  it('skips when messages already exist', () => {
    const conv = makeConversation({ messages: [{ id: MessageId('m1') } as never] })
    maybeTriggerTitleGeneration(CONV_ID, conv, 'Hello world', DEFAULT_SETTINGS, mockChatStream)

    expect(generateTitleMock).not.toHaveBeenCalled()
  })

  it('skips when text is empty or whitespace', () => {
    const conv = makeConversation()
    maybeTriggerTitleGeneration(CONV_ID, conv, '   ', DEFAULT_SETTINGS, mockChatStream)

    expect(generateTitleMock).not.toHaveBeenCalled()
  })
})
