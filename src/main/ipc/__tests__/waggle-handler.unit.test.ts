import { ConversationId, MessageId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  typedOnMock,
  runWaggleSequentialMock,
  getSettingsMock,
  getConversationMock,
  saveConversationMock,
  withConversationLockMock,
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
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  typedOnMock: vi.fn(),
  runWaggleSequentialMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getConversationMock: vi.fn(),
  saveConversationMock: vi.fn(),
  withConversationLockMock: vi.fn(),
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
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
}

function getSendHandler(name: string): ((...args: unknown[]) => Promise<void>) | undefined {
  const call = typedOnMock.mock.calls.find((c: unknown[]) => c[0] === name)
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(handler(...args))
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
    withConversationLockMock.mockReset()
    emitStreamChunkMock.mockReset()
    emitWaggleStreamChunkMock.mockReset()
    emitWaggleTurnEventMock.mockReset()
    clearAgentPhaseMock.mockReset()
    classifyAgentErrorMock.mockReset()
    makeErrorInfoMock.mockReset()
    hydrateAttachmentSourcesMock.mockReset()
    hydrateAttachmentSourcesMock.mockImplementation(async (attachments: unknown) => attachments)
    generateTitleMock.mockReset()

    withConversationLockMock.mockImplementation(async (_id: unknown, fn: () => Promise<void>) =>
      fn(),
    )
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
        ConversationId('conv-new'),
        'Review my code',
        expect.anything(),
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

      expect(withConversationLockMock).toHaveBeenCalledOnce()
      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          waggleConfig: validWaggleConfig(),
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
      expect(withConversationLockMock).not.toHaveBeenCalled()
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
      withConversationLockMock.mockRejectedValue(new Error('Disk full'))

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
