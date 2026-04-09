import type { Message } from '@shared/types/agent'
import { ConversationId, MessageId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  typedOnMock,
  runAgentMock,
  getSettingsMock,
  getConversationMock,
  saveConversationMock,
  withConversationLockMock,
  emitStreamChunkMock,
  clearAgentPhaseMock,
  cancelAllForConversationMock,
  answerQuestionMock,
  cancelQuestionMock,
  cancelPlanProposalMock,
  respondToPlanMock,
  clearContextMock,
  pushContextMock,
  buildPersistedUserMessagePartsMock,
  makeMessageMock,
  hydrateAttachmentSourcesMock,
  getPhaseForConversationMock,
  startStreamBufferMock,
  clearStreamBufferMock,
  emitRunCompletedMock,
  getStreamBufferMock,
  listStreamBuffersMock,
  classifyAgentErrorMock,
  makeErrorInfoMock,
  cleanupConversationRunMock,
  providerRegistryMock,
  generateTitleMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  typedOnMock: vi.fn(),
  runAgentMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getConversationMock: vi.fn(),
  saveConversationMock: vi.fn(),
  withConversationLockMock: vi.fn(),
  emitStreamChunkMock: vi.fn(),
  clearAgentPhaseMock: vi.fn(),
  cancelAllForConversationMock: vi.fn(),
  answerQuestionMock: vi.fn(),
  cancelQuestionMock: vi.fn(),
  cancelPlanProposalMock: vi.fn(),
  respondToPlanMock: vi.fn(),
  clearContextMock: vi.fn(),
  pushContextMock: vi.fn(),
  buildPersistedUserMessagePartsMock: vi.fn(() => [{ type: 'text', text: '' }]),
  makeMessageMock: vi.fn(
    (role: string, parts: unknown[], model?: string) =>
      ({ id: 'msg-mock', role, parts, model, createdAt: Date.now() }) as unknown,
  ),
  hydrateAttachmentSourcesMock: vi.fn(async (attachments: unknown) => attachments),
  getPhaseForConversationMock: vi.fn(),
  startStreamBufferMock: vi.fn(),
  clearStreamBufferMock: vi.fn(),
  emitRunCompletedMock: vi.fn(),
  getStreamBufferMock: vi.fn(() => null),
  listStreamBuffersMock: vi.fn(() => []),
  classifyAgentErrorMock: vi.fn(() => ({
    code: 'unknown',
    userMessage: 'An error occurred',
    retry: false,
  })),
  makeErrorInfoMock: vi.fn((code: string, msg: string) => ({
    code,
    userMessage: msg,
    retry: false,
  })),
  cleanupConversationRunMock: vi.fn(),
  providerRegistryMock: { isKnownModel: vi.fn((_model: string) => true) },
  generateTitleMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../../agent/agent-loop', () => ({
  runAgent: runAgentMock,
}))

vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
}))

vi.mock('../../store/conversations', () => ({
  getConversation: getConversationMock,
  saveConversation: saveConversationMock,
}))

vi.mock('../../store/conversation-lock', () => ({
  withConversationLock: withConversationLockMock,
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
  clearAgentPhase: clearAgentPhaseMock,
  startStreamBuffer: startStreamBufferMock,
  clearStreamBuffer: clearStreamBufferMock,
  emitRunCompleted: emitRunCompletedMock,
  getStreamBuffer: getStreamBufferMock,
  listStreamBuffers: listStreamBuffersMock,
}))

vi.mock('../../orchestration/active-runs', () => ({
  cancelAllForConversation: cancelAllForConversationMock,
}))

vi.mock('../../tools/question-manager', () => ({
  answerQuestion: answerQuestionMock,
  cancelQuestion: cancelQuestionMock,
}))

vi.mock('../../tools/plan-manager', () => ({
  cancelPlanProposal: cancelPlanProposalMock,
  respondToPlan: respondToPlanMock,
}))

vi.mock('../../tools/context-injection-buffer', () => ({
  clearContext: clearContextMock,
  pushContext: pushContextMock,
}))

vi.mock('../../agent/shared', () => ({
  buildPersistedUserMessageParts: buildPersistedUserMessagePartsMock,
  makeMessage: makeMessageMock,
}))

vi.mock('../attachments-handler', () => ({
  hydrateAttachmentSources: hydrateAttachmentSourcesMock,
}))

vi.mock('../../agent/phase-tracker', () => ({
  getPhaseForConversation: getPhaseForConversationMock,
}))

vi.mock('../../agent/error-classifier', () => ({
  classifyAgentError: classifyAgentErrorMock,
  makeErrorInfo: makeErrorInfoMock,
}))

vi.mock('../../agent/conversation-cleanup', () => ({
  cleanupConversationRun: cleanupConversationRunMock,
}))

vi.mock('../../agent/title-generator', () => ({
  generateTitle: generateTitleMock,
}))

vi.mock('../../providers/registry', () => ({
  providerRegistry: providerRegistryMock,
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { Layer } from 'effect'
import { ConversationRepositoryError } from '../../errors'
import { ChatService } from '../../ports/chat-service'
import { ConversationRepository } from '../../ports/conversation-repository'
import { ProviderService } from '../../ports/provider-service'
import { SettingsService } from '../../services/settings-service'
import { registerAgentHandlers } from '../agent-handler'

const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.sync(() => getSettingsMock()),
  update: () => Effect.void,
  transformMcpServers: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestConversationRepoLayer = Layer.succeed(ConversationRepository, {
  get: (id) => Effect.promise(async () => getConversationMock(id)),
  save: (conv) =>
    Effect.tryPromise({
      try: async () => {
        await saveConversationMock(conv)
      },
      catch: (cause) => new ConversationRepositoryError({ operation: 'save', cause }),
    }),
  list: () => Effect.succeed([]),
  create: () => Effect.succeed({} as never),
  delete: () => Effect.void,
  archive: () => Effect.void,
  unarchive: () => Effect.void,
  listArchived: () => Effect.succeed([]),
  updateTitle: () => Effect.void,
  updateProjectPath: () => Effect.void,
  updatePlanMode: () => Effect.void,
})

const TestProviderServiceLayer = Layer.succeed(ProviderService, {
  get: () => Effect.succeed(undefined),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.succeed({} as never),
  isKnownModel: (modelId) => Effect.sync(() => providerRegistryMock.isKnownModel(modelId)),
  createChatAdapter: () => Effect.succeed({} as never),
  indexModels: () => Effect.void,
  fetchModels: () => Effect.succeed([]),
})

const TestChatServiceLayer = Layer.succeed(ChatService, {
  stream: () =>
    Effect.succeed(
      (async function* () {
        /* noop — runAgent is mocked */
      })(),
    ),
  testConnection: () => Effect.void,
})

const TestLayer = Layer.mergeAll(
  TestSettingsLayer,
  TestConversationRepoLayer,
  TestProviderServiceLayer,
  TestChatServiceLayer,
)

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown>) =>
    Effect.runPromise(Effect.provide(effect, TestLayer)),
  runAppEffectExit: (effect: Effect.Effect<unknown>) =>
    Effect.runPromise(Effect.provide(effect, TestLayer)),
}))

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

function getOnHandler(name: string): ((...args: unknown[]) => Promise<void>) | undefined {
  const call = typedOnMock.mock.calls.find((args: unknown[]) => args[0] === name)
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), TestLayer))
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

function newThreadConversation(): Conversation {
  return {
    id: ConversationId('conv-new'),
    title: 'New thread',
    projectPath: '/tmp/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function baseSettings() {
  return {
    ...DEFAULT_SETTINGS,
  }
}

function basePayload(text = '') {
  return {
    text,
    qualityPreset: 'medium' as const,
    attachments: [],
  }
}

function assistantMessage(text = 'Hello back'): Message {
  return {
    id: MessageId('assistant-1'),
    role: 'assistant',
    parts: [{ type: 'text', text }],
    createdAt: Date.now(),
  }
}

describe('registerAgentHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
    runAgentMock.mockReset()
    getSettingsMock.mockReset()
    getConversationMock.mockReset()
    saveConversationMock.mockReset()
    withConversationLockMock.mockReset()
    emitStreamChunkMock.mockReset()
    clearAgentPhaseMock.mockReset()
    cancelAllForConversationMock.mockReset()
    cleanupConversationRunMock.mockReset()
    providerRegistryMock.isKnownModel.mockReset()
    providerRegistryMock.isKnownModel.mockReturnValue(true)
    answerQuestionMock.mockReset()
    cancelQuestionMock.mockReset()
    clearContextMock.mockReset()
    pushContextMock.mockReset()
    hydrateAttachmentSourcesMock.mockReset()
    getPhaseForConversationMock.mockReset()
    classifyAgentErrorMock.mockReset()
    makeErrorInfoMock.mockReset()
    generateTitleMock.mockReset()

    hydrateAttachmentSourcesMock.mockImplementation(async (attachments: unknown) => attachments)
    withConversationLockMock.mockImplementation(async (_id: unknown, fn: () => Promise<void>) =>
      fn(),
    )
    getSettingsMock.mockReturnValue(baseSettings())
    getConversationMock.mockResolvedValue(baseConversation())
    classifyAgentErrorMock.mockReturnValue({
      code: 'unknown',
      userMessage: 'An error occurred',
      retry: false,
    })
    makeErrorInfoMock.mockImplementation((code: string, msg: string) => ({
      code,
      userMessage: msg,
      retry: false,
    }))
  })

  it('registers all expected IPC channels', () => {
    registerAgentHandlers()

    const handleChannels = typedHandleMock.mock.calls.map((args: unknown[]) => args[0])
    const onChannels = typedOnMock.mock.calls.map((args: unknown[]) => args[0])

    expect(handleChannels).toContain('agent:send-message')
    expect(handleChannels).toContain('agent:get-phase')
    expect(handleChannels).toContain('agent:answer-question')
    expect(onChannels).toContain('agent:cancel')
    expect(onChannels).toContain('agent:inject-context')
  })

  // ─── agent:send-message ────────────────────────────────────

  describe('agent:send-message', () => {
    it('does not persist anything when classic run aborts', async () => {
      runAgentMock.mockRejectedValueOnce(new Error('aborted'))

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')
      expect(handler).toBeDefined()

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(withConversationLockMock).not.toHaveBeenCalled()
      expect(saveConversationMock).not.toHaveBeenCalled()
      expect(emitStreamChunkMock).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'RUN_ERROR' }),
      )
    })

    it('skips persistence when a run returns zero messages', async () => {
      runAgentMock.mockResolvedValueOnce({
        newMessages: [] as readonly Message[],
        finalMessage: assistantMessage('noop'),
      })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(withConversationLockMock).not.toHaveBeenCalled()
      expect(saveConversationMock).not.toHaveBeenCalled()
    })

    it('emits RUN_ERROR + RUN_FINISHED when conversation not found', async () => {
      getConversationMock.mockResolvedValue(null)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-gone'), basePayload(), 'claude-sonnet-4-5')

      expect(makeErrorInfoMock).toHaveBeenCalledWith(
        'conversation-not-found',
        'Conversation not found',
      )
      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-gone'),
        expect.objectContaining({ type: 'RUN_ERROR' }),
      )
      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-gone'),
        expect.objectContaining({ type: 'RUN_FINISHED', finishReason: 'stop' }),
      )
      // Should not attempt to run agent
      expect(runAgentMock).not.toHaveBeenCalled()
    })

    it('persists the user message before emitting unknown-model failure', async () => {
      providerRegistryMock.isKnownModel.mockReturnValue(false)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload('hello world'), 'claude-sonnet-4-5')

      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
            }),
          ]),
        }),
      )
      expect(runAgentMock).not.toHaveBeenCalled()
    })

    it('fires LLM title generation for new thread with non-empty text', async () => {
      const conv = newThreadConversation()
      getConversationMock.mockResolvedValue(conv)
      runAgentMock.mockResolvedValueOnce({
        newMessages: [assistantMessage()],
      })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.(
        {},
        ConversationId('conv-new'),
        basePayload('Fix the login bug'),
        'claude-sonnet-4-5',
      )

      expect(generateTitleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: ConversationId('conv-new'),
          userText: 'Fix the login bug',
        }),
      )
    })

    it('does not fire title generation when text is empty/whitespace', async () => {
      const conv = newThreadConversation()
      getConversationMock.mockResolvedValue(conv)
      runAgentMock.mockResolvedValueOnce({
        newMessages: [assistantMessage()],
      })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-new'), basePayload('   '), 'claude-sonnet-4-5')

      expect(generateTitleMock).not.toHaveBeenCalled()
    })

    it('persists new messages via conversation lock on classic mode', async () => {
      const msg = assistantMessage()
      runAgentMock.mockResolvedValueOnce({ newMessages: [msg] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // Persistence now uses ConversationRepository port (locking is internal to adapter)
      expect(saveConversationMock).toHaveBeenCalled()
    })

    it('does not persist when conversation was deleted during run', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [assistantMessage()] })

      // First call returns the conversation, second (in lock) returns null
      getConversationMock.mockResolvedValueOnce(baseConversation()).mockResolvedValueOnce(null)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // saveConversation should NOT be called since the conversation vanished
      // (ConversationRepository.get returns null via catchAll, handler skips save)
      expect(saveConversationMock).not.toHaveBeenCalled()
    })

    it('completes successfully even when persistence fails (service handles error internally)', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [assistantMessage()] })
      // Simulate persistence failure — saveConversation throws
      saveConversationMock.mockRejectedValueOnce(new Error('disk full'))

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      // The run completes — persistence failure is caught by the application service
      // and logged, not propagated as a RUN_ERROR. This is by design: partial
      // persistence failure should not crash the user's experience.
      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')
    })

    it('emits RUN_ERROR + RUN_FINISHED on non-abort error', async () => {
      runAgentMock.mockRejectedValueOnce(new Error('API rate limit exceeded'))

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(classifyAgentErrorMock).toHaveBeenCalledWith(expect.any(Error))
      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({ type: 'RUN_ERROR' }),
      )
      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({ type: 'RUN_FINISHED' }),
      )
    })

    it('persists the user message when a run fails before assistant output', async () => {
      runAgentMock.mockRejectedValueOnce(new Error('API rate limit exceeded'))

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        basePayload('summarize this app'),
        'claude-sonnet-4-5',
      )

      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
            }),
          ]),
        }),
      )
    })

    it('cancels existing run for same conversation before starting new one', async () => {
      // First run: start and do not finish yet
      let firstRunResolve: (v: { newMessages: readonly Message[] }) => void
      const firstRunPromise = new Promise<{ newMessages: readonly Message[] }>((resolve) => {
        firstRunResolve = resolve
      })
      runAgentMock.mockReturnValueOnce(firstRunPromise)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      // Start first run (don't await)
      const run1 = handler?.(
        {},
        ConversationId('conv-1'),
        basePayload('first'),
        'claude-sonnet-4-5',
      )

      // Start second run on same conversation
      runAgentMock.mockResolvedValueOnce({ newMessages: [] })
      const run2 = handler?.(
        {},
        ConversationId('conv-1'),
        basePayload('second'),
        'claude-sonnet-4-5',
      )

      // Resolve first run to complete promise
      // biome-ignore lint/style/noNonNullAssertion: test helper
      firstRunResolve!({ newMessages: [] })
      await Promise.all([run1, run2])

      // The second run should have called clearAgentPhase for the first run's abort
      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('fires LLM title generation on first user message', async () => {
      const conv: Conversation = {
        id: ConversationId('conv-1'),
        title: 'New thread',
        projectPath: '/tmp/repo',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }
      getConversationMock.mockResolvedValue(conv)
      runAgentMock.mockResolvedValueOnce({ newMessages: [assistantMessage()] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        basePayload('How do I deploy?'),
        'claude-sonnet-4-5',
      )

      expect(generateTitleMock).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationId: ConversationId('conv-1'),
          userText: 'How do I deploy?',
        }),
      )
    })

    it('cleans up activeRuns entry after successful completion', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [assistantMessage()] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // The handler should have cleaned up — a second send should not call clearAgentPhase
      // for a stale controller (only from the finally block)
      clearAgentPhaseMock.mockReset()
      runAgentMock.mockResolvedValueOnce({ newMessages: [] })
      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // clearAgentPhase IS called once (from finally block), but NOT for aborting a stale controller
      expect(clearAgentPhaseMock).toHaveBeenCalledTimes(1)
    })

    it('clears agent phase in finally block after successful run', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [assistantMessage()] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('clears agent phase in finally block after error', async () => {
      runAgentMock.mockRejectedValueOnce(new Error('API error'))

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('hydrates attachment sources before passing to agent', async () => {
      const attachments = [
        {
          id: 'att-1',
          kind: 'text',
          name: 'test.txt',
          path: '/tmp/test.txt',
          mimeType: 'text/plain',
          sizeBytes: 10,
          extractedText: '',
        },
      ]
      hydrateAttachmentSourcesMock.mockResolvedValueOnce([
        { ...attachments[0], source: { type: 'data', value: 'aGVsbG8=', mimeType: 'text/plain' } },
      ])
      runAgentMock.mockResolvedValueOnce({ newMessages: [] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        { text: '', qualityPreset: 'medium', attachments },
        'claude-sonnet-4-5',
      )

      expect(hydrateAttachmentSourcesMock).toHaveBeenCalledWith(attachments)
    })
  })

  // ─── agent:cancel ──────────────────────────────────────────

  describe('agent:cancel', () => {
    it('cancels a specific conversation run when conversationId is provided', async () => {
      // First, start a run to populate activeRuns
      runAgentMock.mockReturnValueOnce(new Promise(() => {})) // never resolves

      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const cancelHandler = getOnHandler('agent:cancel')

      // Start a run (don't await — it hangs)
      sendHandler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // Cancel it
      await cancelHandler?.({}, ConversationId('conv-1'))

      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('conv-1'))
      expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('cancels all active runs when no conversationId is provided', async () => {
      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const cancelHandler = getOnHandler('agent:cancel')

      // Start two runs on different conversations
      runAgentMock.mockReturnValue(new Promise(() => {}))
      sendHandler?.({}, ConversationId('conv-a'), basePayload(), 'claude-sonnet-4-5')
      sendHandler?.({}, ConversationId('conv-b'), basePayload(), 'claude-sonnet-4-5')

      // Cancel all
      await cancelHandler?.({})

      expect(clearAgentPhaseMock).toHaveBeenCalled()
      expect(cleanupConversationRunMock).toHaveBeenCalled()
    })

    it('is a no-op when cancelling a non-existent conversation', async () => {
      registerAgentHandlers()
      const cancelHandler = getOnHandler('agent:cancel')

      // Should not throw
      await cancelHandler?.({}, ConversationId('nonexistent'))

      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('nonexistent'))
      expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('nonexistent'))
    })

    it('persists user message and partial assistant content on cancel', async () => {
      const finalizedParts = [{ type: 'text' as const, text: 'Partial assistant response...' }]
      const mockCollector = { finalizeParts: vi.fn(() => finalizedParts) }

      // Start a run that will populate metadata via onCollectorCreated + onPayloadHydrated
      runAgentMock.mockImplementation((opts: { onCollectorCreated?: (c: unknown) => void }) => {
        opts.onCollectorCreated?.(mockCollector)
        return new Promise(() => {}) // never resolves
      })

      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const cancelHandler = getOnHandler('agent:cancel')

      // Start a run (don't await — it hangs)
      sendHandler?.({}, ConversationId('conv-1'), basePayload('hello'), 'claude-sonnet-4-5')

      // Allow microtasks (hydration) to complete
      await new Promise((r) => setTimeout(r, 10))

      // Cancel it
      saveConversationMock.mockReset()
      await cancelHandler?.({}, ConversationId('conv-1'))

      expect(mockCollector.finalizeParts).toHaveBeenCalledWith({ timedOut: true })
      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user' }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        }),
      )
    })

    it('persists only user message when cancel arrives before streaming starts', async () => {
      // Start a run — onCollectorCreated NOT called (cancel before streaming)
      // but onPayloadHydrated IS called (hydration completed)
      runAgentMock.mockImplementation(() => new Promise(() => {}))

      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const cancelHandler = getOnHandler('agent:cancel')

      sendHandler?.({}, ConversationId('conv-1'), basePayload('hello'), 'claude-sonnet-4-5')
      await new Promise((r) => setTimeout(r, 10))

      saveConversationMock.mockReset()
      await cancelHandler?.({}, ConversationId('conv-1'))

      // User message should be persisted (via persistPartialResponse with empty parts)
      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
        }),
      )
      // No assistant message since collector was never created
      const savedConv = saveConversationMock.mock.calls[0]?.[0]
      const savedMessages = savedConv?.messages ?? []
      const assistantMessages = savedMessages.filter(
        (m: { role: string }) => m.role === 'assistant',
      )
      expect(assistantMessages).toHaveLength(0)
    })

    it('does not persist when cancel arrives before payload hydration', async () => {
      // Hydration takes time — cancel arrives before it completes
      hydrateAttachmentSourcesMock.mockImplementation(
        () => new Promise(() => {}), // never resolves
      )
      runAgentMock.mockImplementation(() => new Promise(() => {}))

      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const cancelHandler = getOnHandler('agent:cancel')

      sendHandler?.({}, ConversationId('conv-1'), basePayload('hello'), 'claude-sonnet-4-5')
      // Don't wait for hydration

      saveConversationMock.mockReset()
      await cancelHandler?.({}, ConversationId('conv-1'))

      // No persistence — payload was never hydrated so metadata.payload is null
      expect(saveConversationMock).not.toHaveBeenCalled()
    })
  })

  // ─── agent:get-phase ───────────────────────────────────────

  describe('agent:get-phase', () => {
    it('returns the phase for a given conversation', async () => {
      const phase = { label: 'Thinking' as const, startedAt: 123 }
      getPhaseForConversationMock.mockReturnValue(phase)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:get-phase')

      const result = await handler?.({}, ConversationId('conv-1'))
      expect(result).toEqual(phase)
      expect(getPhaseForConversationMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('returns null when no phase exists', async () => {
      getPhaseForConversationMock.mockReturnValue(null)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:get-phase')

      const result = await handler?.({}, ConversationId('conv-1'))
      expect(result).toBeNull()
    })
  })

  // ─── agent:answer-question ─────────────────────────────────

  describe('agent:answer-question', () => {
    it('forwards answers to the question manager', async () => {
      registerAgentHandlers()
      const handler = getInvokeHandler('agent:answer-question')

      const answers = [{ question: 'Which framework?', selectedOption: 'React' }]
      await handler?.({}, ConversationId('conv-1'), answers)

      expect(answerQuestionMock).toHaveBeenCalledWith(ConversationId('conv-1'), answers)
    })
  })

  // ─── context injection buffer cleanup ──────────────────────

  describe('context injection buffer', () => {
    it('calls cleanupConversationRun on run start', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('calls cleanupConversationRun on cancel', async () => {
      registerAgentHandlers()
      const cancelHandler = getOnHandler('agent:cancel')

      await cancelHandler?.({}, ConversationId('conv-1'))

      expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('calls cleanupConversationRun on cancel-all', async () => {
      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const cancelHandler = getOnHandler('agent:cancel')

      runAgentMock.mockReturnValue(new Promise(() => {}))
      sendHandler?.({}, ConversationId('conv-a'), basePayload(), 'claude-sonnet-4-5')

      await cancelHandler?.({})

      expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('conv-a'))
    })

    it('agent:inject-context handler calls pushContext', async () => {
      registerAgentHandlers()
      const handler = getOnHandler('agent:inject-context')
      expect(handler).toBeDefined()

      await handler?.({}, ConversationId('conv-1'), 'user hint')

      expect(pushContextMock).toHaveBeenCalledWith(ConversationId('conv-1'), 'user hint')
    })

    it('steer persists partial response with timedOut finalization', async () => {
      const finalizedParts = [{ type: 'text' as const, text: 'Partial...' }]
      const mockCollector = { finalizeParts: vi.fn(() => finalizedParts) }

      runAgentMock.mockImplementation((opts: { onCollectorCreated?: (c: unknown) => void }) => {
        opts.onCollectorCreated?.(mockCollector)
        return new Promise(() => {})
      })

      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const steerHandler = getInvokeHandler('agent:steer')

      sendHandler?.({}, ConversationId('conv-1'), basePayload('hello'), 'claude-sonnet-4-5')
      await new Promise((r) => setTimeout(r, 10))

      saveConversationMock.mockReset()
      const result = await steerHandler?.({}, ConversationId('conv-1'))

      expect(result).toEqual({ preserved: true })
      expect(mockCollector.finalizeParts).toHaveBeenCalledWith({ timedOut: true })
      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user' }),
            expect.objectContaining({ role: 'assistant' }),
          ]),
        }),
      )
    })

    it('calls cleanupConversationRun on steer early-return (no collector)', async () => {
      // Start a run to populate activeRuns
      runAgentMock.mockReturnValueOnce(new Promise(() => {})) // never resolves

      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const steerHandler = getInvokeHandler('agent:steer')

      // Start a run (don't await)
      sendHandler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // Steer — collector is null at this point, so early-return path fires
      cleanupConversationRunMock.mockReset()
      const result = await steerHandler?.({}, ConversationId('conv-1'))

      expect(result).toEqual({ preserved: false })
      expect(cleanupConversationRunMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })
  })
})
