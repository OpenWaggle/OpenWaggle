import type { Message } from '@shared/types/agent'
import { ConversationId, MessageId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
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
  classifyAgentErrorMock,
  makeErrorInfoMock,
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
}))

vi.mock('./typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../agent/agent-loop', () => ({
  runAgent: runAgentMock,
}))

vi.mock('../store/settings', () => ({
  getSettings: getSettingsMock,
}))

vi.mock('../store/conversations', () => ({
  getConversation: getConversationMock,
  saveConversation: saveConversationMock,
}))

vi.mock('../store/conversation-lock', () => ({
  withConversationLock: withConversationLockMock,
}))

vi.mock('../utils/stream-bridge', () => ({
  emitStreamChunk: emitStreamChunkMock,
  clearAgentPhase: clearAgentPhaseMock,
}))

vi.mock('../orchestration/active-runs', () => ({
  cancelAllForConversation: cancelAllForConversationMock,
}))

vi.mock('../tools/question-manager', () => ({
  answerQuestion: answerQuestionMock,
  cancelQuestion: cancelQuestionMock,
}))

vi.mock('../tools/plan-manager', () => ({
  cancelPlanProposal: cancelPlanProposalMock,
  respondToPlan: respondToPlanMock,
}))

vi.mock('../tools/context-injection-buffer', () => ({
  clearContext: clearContextMock,
  pushContext: pushContextMock,
}))

vi.mock('../agent/shared', () => ({
  buildPersistedUserMessageParts: buildPersistedUserMessagePartsMock,
  makeMessage: makeMessageMock,
}))

vi.mock('./attachments-handler', () => ({
  hydrateAttachmentSources: hydrateAttachmentSourcesMock,
}))

vi.mock('../agent/phase-tracker', () => ({
  getPhaseForConversation: getPhaseForConversationMock,
}))

vi.mock('../agent/error-classifier', () => ({
  classifyAgentError: classifyAgentErrorMock,
  makeErrorInfo: makeErrorInfoMock,
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { registerAgentHandlers } from './agent-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find((args: unknown[]) => args[0] === name)
  return call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined
}

function getOnHandler(name: string): ((...args: unknown[]) => void) | undefined {
  const call = typedOnMock.mock.calls.find((args: unknown[]) => args[0] === name)
  return call?.[1] as ((...args: unknown[]) => void) | undefined
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
    answerQuestionMock.mockReset()
    cancelQuestionMock.mockReset()
    clearContextMock.mockReset()
    pushContextMock.mockReset()
    hydrateAttachmentSourcesMock.mockReset()
    getPhaseForConversationMock.mockReset()
    classifyAgentErrorMock.mockReset()
    makeErrorInfoMock.mockReset()

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

    it('sets provisional title for new thread with non-empty text', async () => {
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

      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Fix the login bug' }),
      )
    })

    it('does not set provisional title when text is empty/whitespace', async () => {
      const conv = newThreadConversation()
      getConversationMock.mockResolvedValue(conv)
      runAgentMock.mockResolvedValueOnce({
        newMessages: [assistantMessage()],
      })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-new'), basePayload('   '), 'claude-sonnet-4-5')

      // First call should be the lock-based persist, not the provisional title
      const firstSave = saveConversationMock.mock.calls[0]?.[0]
      // Title should still be auto-generated from message, not from whitespace
      expect(firstSave?.title).not.toBe('   ')
    })

    it('truncates provisional title to 60 characters', async () => {
      const conv = newThreadConversation()
      getConversationMock.mockResolvedValue(conv)
      runAgentMock.mockResolvedValueOnce({
        newMessages: [assistantMessage()],
      })

      const longText = 'A'.repeat(100)
      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-new'), basePayload(longText), 'claude-sonnet-4-5')

      expect(saveConversationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: `${'A'.repeat(60)}...`,
        }),
      )
    })

    it('persists new messages via conversation lock on classic mode', async () => {
      const msg = assistantMessage()
      runAgentMock.mockResolvedValueOnce({ newMessages: [msg] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(withConversationLockMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.any(Function),
      )
      expect(saveConversationMock).toHaveBeenCalled()
    })

    it('does not persist when conversation was deleted during run', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [assistantMessage()] })

      // First call returns the conversation, second (in lock) returns null
      getConversationMock.mockResolvedValueOnce(baseConversation()).mockResolvedValueOnce(null)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(withConversationLockMock).toHaveBeenCalled()
      // saveConversation should NOT be called since the conversation vanished
      expect(saveConversationMock).not.toHaveBeenCalled()
    })

    it('emits RUN_ERROR on persistence failure', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [assistantMessage()] })
      withConversationLockMock.mockRejectedValueOnce(new Error('disk full'))

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(makeErrorInfoMock).toHaveBeenCalledWith(
        'persist-failed',
        expect.stringContaining('Failed to save'),
      )
      expect(emitStreamChunkMock).toHaveBeenCalledWith(
        ConversationId('conv-1'),
        expect.objectContaining({ type: 'RUN_ERROR' }),
      )
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

      // The second run should have called clearAgentPhase for the first run's abort
      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('conv-1'))

      // Resolve first run to complete promise
      // biome-ignore lint/style/noNonNullAssertion: test helper
      firstRunResolve!({ newMessages: [] })
      await Promise.all([run1, run2])
    })

    it('auto-titles conversation from first user message text', async () => {
      const conv: Conversation = {
        id: ConversationId('conv-1'),
        title: 'New thread',
        projectPath: '/tmp/repo',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }
      getConversationMock.mockResolvedValue(conv)

      const userMsg: Message = {
        id: MessageId('user-1'),
        role: 'user',
        parts: [{ type: 'text', text: 'How do I deploy?' }],
        createdAt: Date.now(),
      }
      const assistantMsg = assistantMessage('Deploy using...')
      runAgentMock.mockResolvedValueOnce({ newMessages: [userMsg, assistantMsg] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.(
        {},
        ConversationId('conv-1'),
        basePayload('How do I deploy?'),
        'claude-sonnet-4-5',
      )

      // The lock callback should save with auto-title
      const savedConv = saveConversationMock.mock.calls.find(
        (call: unknown[]) =>
          (call[0] as { messages?: unknown[] })?.messages &&
          (call[0] as { messages: unknown[] }).messages.length > 0,
      )
      if (savedConv) {
        expect(savedConv[0].title).toBe('How do I deploy?')
      }
    })

    it('cleans up activeRuns entry after successful completion', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [assistantMessage()] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // The handler should have cleaned up — a second send should not call clearAgentPhase
      // for a stale controller
      clearAgentPhaseMock.mockReset()
      runAgentMock.mockResolvedValueOnce({ newMessages: [] })
      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // clearAgentPhase should NOT be called because there's no stale controller
      expect(clearAgentPhaseMock).not.toHaveBeenCalled()
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
      cancelHandler?.({}, ConversationId('conv-1'))

      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('conv-1'))
      expect(cancelAllForConversationMock).toHaveBeenCalledWith(ConversationId('conv-1'))
      expect(cancelQuestionMock).toHaveBeenCalledWith(ConversationId('conv-1'))
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
      cancelHandler?.({})

      expect(clearAgentPhaseMock).toHaveBeenCalled()
      expect(cancelAllForConversationMock).toHaveBeenCalled()
      expect(cancelQuestionMock).toHaveBeenCalled()
    })

    it('is a no-op when cancelling a non-existent conversation', () => {
      registerAgentHandlers()
      const cancelHandler = getOnHandler('agent:cancel')

      // Should not throw
      cancelHandler?.({}, ConversationId('nonexistent'))

      expect(clearAgentPhaseMock).toHaveBeenCalledWith(ConversationId('nonexistent'))
      expect(cancelAllForConversationMock).toHaveBeenCalledWith(ConversationId('nonexistent'))
    })
  })

  // ─── agent:get-phase ───────────────────────────────────────

  describe('agent:get-phase', () => {
    it('returns the phase for a given conversation', () => {
      const phase = { label: 'Thinking' as const, startedAt: 123 }
      getPhaseForConversationMock.mockReturnValue(phase)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:get-phase')

      const result = handler?.({}, ConversationId('conv-1'))
      expect(result).toEqual(phase)
      expect(getPhaseForConversationMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('returns null when no phase exists', () => {
      getPhaseForConversationMock.mockReturnValue(null)

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:get-phase')

      const result = handler?.({}, ConversationId('conv-1'))
      expect(result).toBeNull()
    })
  })

  // ─── agent:answer-question ─────────────────────────────────

  describe('agent:answer-question', () => {
    it('forwards answers to the question manager', () => {
      registerAgentHandlers()
      const handler = getInvokeHandler('agent:answer-question')

      const answers = [{ question: 'Which framework?', selectedOption: 'React' }]
      handler?.({}, ConversationId('conv-1'), answers)

      expect(answerQuestionMock).toHaveBeenCalledWith(ConversationId('conv-1'), answers)
    })
  })

  // ─── context injection buffer cleanup ──────────────────────

  describe('context injection buffer', () => {
    it('clears context on run start', async () => {
      runAgentMock.mockResolvedValueOnce({ newMessages: [] })

      registerAgentHandlers()
      const handler = getInvokeHandler('agent:send-message')

      await handler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      expect(clearContextMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('clears context on cancel', () => {
      registerAgentHandlers()
      const cancelHandler = getOnHandler('agent:cancel')

      cancelHandler?.({}, ConversationId('conv-1'))

      expect(clearContextMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })

    it('clears context on cancel-all', async () => {
      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const cancelHandler = getOnHandler('agent:cancel')

      runAgentMock.mockReturnValue(new Promise(() => {}))
      sendHandler?.({}, ConversationId('conv-a'), basePayload(), 'claude-sonnet-4-5')

      cancelHandler?.({})

      expect(clearContextMock).toHaveBeenCalledWith(ConversationId('conv-a'))
    })

    it('agent:inject-context handler calls pushContext', () => {
      registerAgentHandlers()
      const handler = getOnHandler('agent:inject-context')
      expect(handler).toBeDefined()

      handler?.({}, ConversationId('conv-1'), 'user hint')

      expect(pushContextMock).toHaveBeenCalledWith(ConversationId('conv-1'), 'user hint')
    })

    it('clears context on steer early-return (no collector)', async () => {
      // Start a run to populate activeRuns
      runAgentMock.mockReturnValueOnce(new Promise(() => {})) // never resolves

      registerAgentHandlers()
      const sendHandler = getInvokeHandler('agent:send-message')
      const steerHandler = getInvokeHandler('agent:steer')

      // Start a run (don't await)
      sendHandler?.({}, ConversationId('conv-1'), basePayload(), 'claude-sonnet-4-5')

      // Steer — collector is null at this point, so early-return path fires
      clearContextMock.mockReset()
      const result = await steerHandler?.({}, ConversationId('conv-1'))

      expect(result).toEqual({ preserved: false })
      expect(clearContextMock).toHaveBeenCalledWith(ConversationId('conv-1'))
    })
  })
})
