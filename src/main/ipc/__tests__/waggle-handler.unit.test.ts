import { ConversationId, MessageId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { AgentStreamChunk } from '@shared/types/stream'
import type { WaggleConfig, WaggleStreamMetadata } from '@shared/types/waggle'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationRepositoryError } from '../../errors'
import { ChatService } from '../../ports/chat-service'
import { ConversationRepository } from '../../ports/conversation-repository'
import { PinnedContextRepository } from '../../ports/pinned-context-repository'
import { ProviderService } from '../../ports/provider-service'
import { SettingsService } from '../../services/settings-service'

const {
  typedHandleMock,
  typedOnMock,
  runWaggleSequentialMock,
  getSettingsMock,
  getConversationMock,
  saveConversationMock,
  emitStreamChunkMock,
  emitWaggleStreamChunkMock,
  emitWaggleTurnEventMock,
  clearAgentPhaseMock,
  startStreamBufferMock,
  clearStreamBufferMock,
  emitRunCompletedMock,
  classifyAgentErrorMock,
  makeErrorInfoMock,
  hydrateAttachmentSourcesMock,
  generateTitleMock,
  buildPersistedUserMessagePartsMock,
  makeMessageMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  typedOnMock: vi.fn(),
  runWaggleSequentialMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getConversationMock: vi.fn(),
  saveConversationMock: vi.fn(),
  emitStreamChunkMock: vi.fn(),
  emitWaggleStreamChunkMock: vi.fn(),
  emitWaggleTurnEventMock: vi.fn(),
  clearAgentPhaseMock: vi.fn(),
  startStreamBufferMock: vi.fn(),
  clearStreamBufferMock: vi.fn(),
  emitRunCompletedMock: vi.fn(),
  classifyAgentErrorMock: vi.fn(),
  makeErrorInfoMock: vi.fn(),
  hydrateAttachmentSourcesMock: vi.fn(async (attachments: unknown) => attachments),
  generateTitleMock: vi.fn(),
  buildPersistedUserMessagePartsMock: vi.fn(() => [{ type: 'text', text: 'test' }]),
  makeMessageMock: vi.fn(
    (role: string, parts: unknown[]) =>
      ({ id: 'msg-mock', role, parts, createdAt: Date.now() }) as unknown,
  ),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../../agent/waggle-coordinator', () => ({
  runWaggleSequential: runWaggleSequentialMock,
}))

vi.mock('../../agent/error-classifier', () => ({
  classifyAgentError: classifyAgentErrorMock,
  makeErrorInfo: makeErrorInfoMock,
}))

const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.sync(() => getSettingsMock()),
  update: () => Effect.void,
  transformMcpServers: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestConversationRepoLayer = Layer.succeed(ConversationRepository, {
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

const TestProviderServiceLayer = Layer.succeed(ProviderService, {
  get: () => Effect.succeed(undefined),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.succeed({} as never),
  isKnownModel: () => Effect.succeed(true),
  createChatAdapter: () => Effect.succeed({} as never),
  indexModels: () => Effect.void,
  fetchModels: () => Effect.succeed([]),
})

const TestChatServiceLayer = Layer.succeed(ChatService, {
  stream: () =>
    Effect.succeed(
      (async function* () {
        /* noop — waggle coordinator is mocked */
      })(),
    ),
  testConnection: () => Effect.void,
})

const TestPinnedContextRepoLayer = Layer.succeed(PinnedContextRepository, {
  list: () => Effect.succeed([]),
  add: () => Effect.succeed({} as never),
  remove: () => Effect.void,
  removeByMessageId: () => Effect.void,
  getTokenEstimate: () => Effect.succeed(0),
})

const TestLayer = Layer.mergeAll(
  TestSettingsLayer,
  TestConversationRepoLayer,
  TestProviderServiceLayer,
  TestChatServiceLayer,
  TestPinnedContextRepoLayer,
)

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown>) =>
    Effect.runPromise(Effect.provide(effect, TestLayer)),
  runAppEffectExit: (effect: Effect.Effect<unknown>) =>
    Effect.runPromise(Effect.provide(effect, TestLayer)),
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
  emitWaggleStreamChunk: emitWaggleStreamChunkMock,
  emitWaggleTurnEvent: emitWaggleTurnEventMock,
  clearAgentPhase: clearAgentPhaseMock,
  startStreamBuffer: startStreamBufferMock,
  clearStreamBuffer: clearStreamBufferMock,
  emitRunCompleted: emitRunCompletedMock,
}))

vi.mock('../attachments-handler', () => ({
  hydrateAttachmentSources: hydrateAttachmentSourcesMock,
}))

vi.mock('../../agent/shared', () => ({
  buildPersistedUserMessageParts: buildPersistedUserMessagePartsMock,
  makeMessage: makeMessageMock,
}))

vi.mock('../../agent/title-generator', () => ({
  generateTitle: generateTitleMock,
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { registerWaggleHandlers } from '../waggle-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), TestLayer))
}

function getSendHandler(name: string): ((...args: unknown[]) => Promise<void>) | undefined {
  const call = typedOnMock.mock.calls.find((c: unknown[]) => c[0] === name)
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), TestLayer))
}

function validWaggleConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Agent A',
        model: SupportedModelId('claude-sonnet-4-5'),
        roleDescription: 'Code reviewer',
        color: 'blue',
      },
      {
        label: 'Agent B',
        model: SupportedModelId('gpt-4.1-mini'),
        roleDescription: 'Implementation expert',
        color: 'amber',
      },
    ],
    stop: {
      primary: 'consensus',
      maxTurnsSafety: 10,
    },
  }
}

function baseConversation(): Conversation {
  return {
    id: ConversationId('conv-1'),
    title: 'Existing thread',
    projectPath: '/tmp/repo',
    messages: [
      {
        id: MessageId('msg-1'),
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        createdAt: 1,
      },
    ],
    createdAt: 1,
    updatedAt: 1,
  }
}

function newConversation(): Conversation {
  return {
    id: ConversationId('conv-new'),
    title: 'New thread',
    projectPath: '/tmp/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('registerWaggleHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
    runWaggleSequentialMock.mockReset()
    getSettingsMock.mockReset()
    getConversationMock.mockReset()
    saveConversationMock.mockReset()
    emitStreamChunkMock.mockReset()
    emitWaggleStreamChunkMock.mockReset()
    emitWaggleTurnEventMock.mockReset()
    clearAgentPhaseMock.mockReset()
    classifyAgentErrorMock.mockReset()
    makeErrorInfoMock.mockReset()
    hydrateAttachmentSourcesMock.mockReset()
    hydrateAttachmentSourcesMock.mockImplementation(async (attachments: unknown) => attachments)
    generateTitleMock.mockReset()

    getSettingsMock.mockReturnValue({ ...DEFAULT_SETTINGS })
    getConversationMock.mockResolvedValue(baseConversation())
    makeErrorInfoMock.mockImplementation((code: string, msg: string) => ({
      code,
      userMessage: msg,
    }))
    classifyAgentErrorMock.mockImplementation((err: Error) => ({
      code: 'agent-error',
      userMessage: err.message,
    }))
  })

  it('registers the expected IPC channels', () => {
    registerWaggleHandlers()

    const typedChannels = typedHandleMock.mock.calls.map((c: unknown[]) => c[0] as string)
    const sendChannels = typedOnMock.mock.calls.map((c: unknown[]) => c[0] as string)

    expect(typedChannels).toContain('agent:send-waggle-message')
    expect(sendChannels).toContain('agent:cancel-waggle')
  })

  describe('agent:send-waggle-message', () => {
    it('emits RUN_ERROR for invalid waggle config', async () => {
      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'hello', qualityPreset: 'medium', attachments: [] },
        { mode: 'invalid' }, // Invalid config
      )

      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'RUN_ERROR',
          error: expect.objectContaining({
            message: 'Invalid Waggle mode configuration',
            code: 'validation-error',
          }),
        }),
      )
      expect(runWaggleSequentialMock).not.toHaveBeenCalled()
    })

    it('emits RUN_ERROR when conversation is not found', async () => {
      getConversationMock.mockResolvedValue(null)
      makeErrorInfoMock.mockReturnValue({
        code: 'conversation-not-found',
        userMessage: 'Conversation not found',
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-missing'),
        { text: 'hello', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-missing'),
        expect.objectContaining({
          type: 'RUN_ERROR',
          error: expect.objectContaining({
            message: 'Conversation not found',
          }),
        }),
      )
      expect(runWaggleSequentialMock).not.toHaveBeenCalled()
    })

    it('emits RUN_ERROR when conversation has no project path', async () => {
      getConversationMock.mockResolvedValue({
        ...baseConversation(),
        projectPath: null,
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'hello', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'RUN_ERROR',
          error: expect.objectContaining({
            message: 'Please select a project folder before starting Waggle mode.',
            code: 'no-project',
          }),
        }),
      )
    })

    it('fires LLM title generation on first message', async () => {
      getConversationMock.mockResolvedValue(newConversation())
      runWaggleSequentialMock.mockResolvedValue({
        newMessages: [],
        lastError: undefined,
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-new'),
        { text: 'Review my code', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      expect(generateTitleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: ConversationId('conv-new'),
          userText: 'Review my code',
        }),
      )
    })

    it('does not generate title when text is empty/whitespace', async () => {
      getConversationMock.mockResolvedValue(newConversation())
      runWaggleSequentialMock.mockResolvedValue({
        newMessages: [],
        lastError: undefined,
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-new'),
        { text: '   ', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      expect(generateTitleMock).not.toHaveBeenCalled()
    })

    it('emits RUN_STARTED and RUN_FINISHED for a successful waggle run', async () => {
      runWaggleSequentialMock.mockResolvedValue({
        newMessages: [
          {
            id: MessageId('assistant-1'),
            role: 'assistant',
            parts: [{ type: 'text', text: 'Result from waggle' }],
            createdAt: Date.now(),
          },
        ],
        lastError: undefined,
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'Do something', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      // Should emit RUN_STARTED
      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'RUN_STARTED',
          runId: 'waggle-conv-1',
        }),
      )

      // Should emit RUN_FINISHED at the end
      const finishCalls = emitStreamChunkMock.mock.calls.filter(
        (c: unknown[]) => (c[1] as { type: string }).type === 'RUN_FINISHED',
      )
      expect(finishCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('emits _turnBoundary with TOOL_CALL_ARGS on turn transition', async () => {
      const turnZeroMeta: WaggleStreamMetadata = {
        agentIndex: 0,
        agentLabel: 'Agent A',
        agentColor: 'blue',
        agentModel: SupportedModelId('claude-sonnet-4-5'),
        turnNumber: 0,
        collaborationMode: 'sequential',
      }
      const turnOneMeta: WaggleStreamMetadata = {
        agentIndex: 1,
        agentLabel: 'Agent B',
        agentColor: 'amber',
        agentModel: SupportedModelId('gpt-4.1-mini'),
        turnNumber: 1,
        collaborationMode: 'sequential',
      }

      runWaggleSequentialMock.mockImplementationOnce(
        async ({
          onStreamChunk,
        }: {
          onStreamChunk: (chunk: AgentStreamChunk, meta: WaggleStreamMetadata) => void
        }) => {
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_CONTENT',
              timestamp: 1,
              messageId: 'msg-turn-0',
              delta: 'turn zero',
            },
            turnZeroMeta,
          )
          onStreamChunk(
            {
              type: 'TOOL_CALL_START',
              timestamp: 2,
              toolCallId: 'tool-turn-1',
              toolName: 'readFile',
            },
            turnOneMeta,
          )

          return {
            newMessages: [
              {
                id: MessageId('assistant-turn-1'),
                role: 'assistant',
                parts: [{ type: 'text', text: 'done' }],
                createdAt: Date.now(),
              },
            ],
            lastError: undefined,
          }
        },
      )

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'Do something', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      expect(emitStreamChunkMock).toHaveBeenNthCalledWith(
        3,
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'TOOL_CALL_START',
          toolCallId: 'turn-boundary-1',
          toolName: '_turnBoundary',
        }),
      )
      expect(emitStreamChunkMock).toHaveBeenNthCalledWith(
        4,
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'TOOL_CALL_ARGS',
          toolCallId: 'turn-boundary-1',
          delta: expect.stringContaining('"agentLabel":"Agent B"'),
        }),
      )
      expect(emitStreamChunkMock).toHaveBeenNthCalledWith(
        5,
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'TOOL_CALL_END',
          toolCallId: 'turn-boundary-1',
          toolName: '_turnBoundary',
          result: JSON.stringify({
            agentIndex: 1,
            agentLabel: 'Agent B',
            agentColor: 'amber',
            agentModel: 'gpt-4.1-mini',
            turnNumber: 1,
          }),
          input: {},
        }),
      )
      expect(emitStreamChunkMock).toHaveBeenNthCalledWith(
        6,
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'TOOL_CALL_START',
          toolCallId: 'tool-turn-1',
          toolName: 'readFile',
        }),
      )
    })

    it('rewrites text message chunk ids to one stable id per waggle turn', async () => {
      const turnZeroMeta: WaggleStreamMetadata = {
        agentIndex: 0,
        agentLabel: 'Agent A',
        agentColor: 'blue',
        agentModel: SupportedModelId('claude-sonnet-4-5'),
        turnNumber: 0,
        collaborationMode: 'sequential',
      }
      const turnOneMeta: WaggleStreamMetadata = {
        agentIndex: 1,
        agentLabel: 'Agent B',
        agentColor: 'amber',
        agentModel: SupportedModelId('gpt-4.1-mini'),
        turnNumber: 1,
        collaborationMode: 'sequential',
      }

      runWaggleSequentialMock.mockImplementationOnce(
        async ({
          onStreamChunk,
        }: {
          onStreamChunk: (chunk: AgentStreamChunk, meta: WaggleStreamMetadata) => void
        }) => {
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_START',
              timestamp: 1,
              messageId: 'turn-0-first-start',
              role: 'assistant',
            },
            turnZeroMeta,
          )
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_CONTENT',
              timestamp: 2,
              messageId: 'turn-0-first-start',
              delta: 'hello',
            },
            turnZeroMeta,
          )
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_START',
              timestamp: 3,
              messageId: 'turn-0-continuation-start',
              role: 'assistant',
            },
            turnZeroMeta,
          )
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_CONTENT',
              timestamp: 4,
              messageId: 'turn-0-continuation-start',
              delta: 'again',
            },
            turnZeroMeta,
          )
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_END',
              timestamp: 5,
              messageId: 'turn-0-continuation-start',
            },
            turnZeroMeta,
          )
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_START',
              timestamp: 6,
              messageId: 'turn-1-start',
              role: 'assistant',
            },
            turnOneMeta,
          )
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_CONTENT',
              timestamp: 7,
              messageId: 'turn-1-start',
              delta: 'critic',
            },
            turnOneMeta,
          )
          onStreamChunk(
            {
              type: 'TEXT_MESSAGE_END',
              timestamp: 8,
              messageId: 'turn-1-start',
            },
            turnOneMeta,
          )

          return {
            newMessages: [
              {
                id: MessageId('assistant-1'),
                role: 'assistant',
                parts: [{ type: 'text', text: 'done' }],
                createdAt: Date.now(),
              },
            ],
            lastError: undefined,
          }
        },
      )

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'Do something', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      const waggleTextCalls = emitWaggleStreamChunkMock.mock.calls.filter((call) => {
        const chunk = call[1] as AgentStreamChunk
        return (
          chunk.type === 'TEXT_MESSAGE_START' ||
          chunk.type === 'TEXT_MESSAGE_CONTENT' ||
          chunk.type === 'TEXT_MESSAGE_END'
        )
      })
      const turnZeroIds = new Set(
        waggleTextCalls
          .filter((call) => (call[2] as WaggleStreamMetadata).turnNumber === 0)
          .map((call) => (call[1] as AgentStreamChunk & { messageId: string }).messageId),
      )
      const turnOneIds = new Set(
        waggleTextCalls
          .filter((call) => (call[2] as WaggleStreamMetadata).turnNumber === 1)
          .map((call) => (call[1] as AgentStreamChunk & { messageId: string }).messageId),
      )

      expect(turnZeroIds.size).toBe(1)
      expect(turnOneIds.size).toBe(1)
      expect(Array.from(turnZeroIds)[0]).not.toBe(Array.from(turnOneIds)[0])
      expect(Array.from(turnZeroIds)[0]).not.toBe('turn-0-continuation-start')

      const mainTextIds = emitStreamChunkMock.mock.calls
        .filter((call) => {
          const chunk = call[1] as AgentStreamChunk
          return (
            chunk.type === 'TEXT_MESSAGE_START' ||
            chunk.type === 'TEXT_MESSAGE_CONTENT' ||
            chunk.type === 'TEXT_MESSAGE_END'
          )
        })
        .map((call) => (call[1] as AgentStreamChunk & { messageId: string }).messageId)
      expect(new Set(mainTextIds)).toEqual(new Set([...turnZeroIds, ...turnOneIds]))
    })

    it('persists conversation with new messages after successful run', async () => {
      const assistantMsg = {
        id: MessageId('assistant-1'),
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: 'Result' }],
        createdAt: Date.now(),
      }
      runWaggleSequentialMock.mockResolvedValue({
        newMessages: [assistantMsg],
        lastError: undefined,
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'Do something', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          waggleConfig: undefined, // Cleared after run — per-message metadata preserves history
        }),
      )
    })

    it('emits RUN_FINISHED when run returns zero messages (aborted/empty)', async () => {
      runWaggleSequentialMock.mockResolvedValue({
        newMessages: [],
        lastError: undefined,
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'Do something', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      // Should still emit RUN_FINISHED for the adapter
      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'RUN_FINISHED',
          finishReason: 'stop',
        }),
      )
      // Should not have tried to persist
      expect(saveConversationMock).not.toHaveBeenCalled()
    })

    it('emits RUN_ERROR when all turns fail (zero assistants with lastError)', async () => {
      runWaggleSequentialMock.mockResolvedValue({
        newMessages: [
          {
            id: MessageId('user-1'),
            role: 'user',
            parts: [{ type: 'text', text: 'request' }],
            createdAt: Date.now(),
          },
        ],
        lastError: 'Insufficient credits',
      })
      classifyAgentErrorMock.mockReturnValue({
        code: 'credits-exhausted',
        userMessage: 'Insufficient credits',
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'Do something', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'RUN_ERROR',
          error: expect.objectContaining({
            message: 'Insufficient credits',
          }),
        }),
      )
    })

    it('handles exception thrown by runWaggleSequential', async () => {
      runWaggleSequentialMock.mockRejectedValue(new Error('Network failure'))
      classifyAgentErrorMock.mockReturnValue({
        code: 'network-error',
        userMessage: 'Network failure',
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'test', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'RUN_ERROR',
          error: expect.objectContaining({ message: 'Network failure' }),
        }),
      )

      // Should also emit RUN_FINISHED after the error
      const finishCalls = emitStreamChunkMock.mock.calls.filter(
        (c: unknown[]) => (c[1] as { type: string }).type === 'RUN_FINISHED',
      )
      expect(finishCalls.length).toBeGreaterThanOrEqual(1)
    })

    it('does not emit RUN_ERROR for abort exceptions', async () => {
      runWaggleSequentialMock.mockRejectedValue(new Error('aborted'))

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'test', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      const errorCalls = emitStreamChunkMock.mock.calls.filter(
        (c: unknown[]) => (c[1] as { type: string }).type === 'RUN_ERROR',
      )
      expect(errorCalls).toHaveLength(0)
    })

    it('cancels existing waggle run when a new one starts for the same conversation', async () => {
      // First run: simulate a run that will block (never resolve)
      let firstRunResolve: ((val: unknown) => void) | undefined
      runWaggleSequentialMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            firstRunResolve = resolve
          }),
      )

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      // Start first run (don't await)
      const firstRunPromise = handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'first', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      // Start second run — should abort the first
      runWaggleSequentialMock.mockResolvedValueOnce({
        newMessages: [],
        lastError: undefined,
      })

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'second', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      // Resolve the first to let it clean up
      firstRunResolve?.({
        newMessages: [],
        lastError: undefined,
      })
      await firstRunPromise

      // clearAgentPhase should have been called when aborting the first run
      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('hydrates attachment sources before running', async () => {
      const attachments = [
        {
          id: 'att-1',
          kind: 'text',
          name: 'file.txt',
          path: '/tmp/file.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          extractedText: 'content',
        },
      ]
      hydrateAttachmentSourcesMock.mockResolvedValue(attachments)

      runWaggleSequentialMock.mockResolvedValue({
        newMessages: [],
        lastError: undefined,
      })

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'test', qualityPreset: 'medium', attachments },
        validWaggleConfig(),
      )

      expect(hydrateAttachmentSourcesMock).toHaveBeenCalledWith(attachments)
    })

    it('handles persistence errors gracefully without crashing', async () => {
      runWaggleSequentialMock.mockResolvedValue({
        newMessages: [
          {
            id: MessageId('assistant-1'),
            role: 'assistant',
            parts: [{ type: 'text', text: 'Result' }],
            createdAt: Date.now(),
          },
        ],
        lastError: undefined,
      })
      saveConversationMock.mockRejectedValue(new Error('Disk full'))

      registerWaggleHandlers()
      const handler = getInvokeHandler('agent:send-waggle-message')

      // Should not throw
      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: 'test', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      // Should still emit RUN_FINISHED even when persistence fails
      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({
          type: 'RUN_FINISHED',
          finishReason: 'stop',
        }),
      )
    })
  })

  describe('agent:cancel-waggle', () => {
    it('aborts an active waggle run and clears phase', async () => {
      // Start a run first to populate activeWaggleRuns
      let capturedSignal: AbortSignal | undefined
      runWaggleSequentialMock.mockImplementation(({ signal }: { signal: AbortSignal }) => {
        capturedSignal = signal
        return new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve({ newMessages: [], lastError: undefined })
          })
        })
      })

      registerWaggleHandlers()
      const sendHandler = getInvokeHandler('agent:send-waggle-message')
      const cancelHandler = getSendHandler('agent:cancel-waggle')

      // Start the run but don't await it
      const runPromise = sendHandler?.(
        {},
        ConversationId('conv-1'),
        { text: 'test', qualityPreset: 'medium', attachments: [] },
        validWaggleConfig(),
      )

      // Wait a tick for the run to register the abort controller
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Cancel it
      await cancelHandler?.({}, ConversationId('conv-1'))
      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('conv-1'))

      // The signal should be aborted
      expect(capturedSignal?.aborted).toBe(true)

      // Cleanup
      await runPromise
    })

    it('silently ignores cancel for non-existent conversation', async () => {
      registerWaggleHandlers()
      const cancelHandler = getSendHandler('agent:cancel-waggle')

      // Should not throw
      await expect(cancelHandler?.({}, ConversationId('nonexistent'))).resolves.not.toThrow()
      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('nonexistent'))
    })
  })
})
