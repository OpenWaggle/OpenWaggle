import type { Message } from '@shared/types/agent'
import { ConversationId, MessageId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  typedOnMock,
  runAgentMock,
  runOrchestratedAgentMock,
  getSettingsMock,
  getConversationMock,
  saveConversationMock,
  withConversationLockMock,
  emitStreamChunkMock,
  emitOrchestrationEventMock,
  cancelAllForConversationMock,
  registerActiveOrchestrationRunMock,
  unregisterActiveOrchestrationRunMock,
  answerQuestionMock,
  cancelQuestionMock,
  hydrateAttachmentSourcesMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  typedOnMock: vi.fn(),
  runAgentMock: vi.fn(),
  runOrchestratedAgentMock: vi.fn(),
  getSettingsMock: vi.fn(),
  getConversationMock: vi.fn(),
  saveConversationMock: vi.fn(),
  withConversationLockMock: vi.fn(),
  emitStreamChunkMock: vi.fn(),
  emitOrchestrationEventMock: vi.fn(),
  cancelAllForConversationMock: vi.fn(),
  registerActiveOrchestrationRunMock: vi.fn(),
  unregisterActiveOrchestrationRunMock: vi.fn(),
  answerQuestionMock: vi.fn(),
  cancelQuestionMock: vi.fn(),
  hydrateAttachmentSourcesMock: vi.fn(async (attachments: unknown) => attachments),
}))

vi.mock('./typed-ipc', () => ({
  typedHandle: typedHandleMock,
  typedOn: typedOnMock,
}))

vi.mock('../agent/agent-loop', () => ({
  runAgent: runAgentMock,
}))

vi.mock('../orchestration/service', () => ({
  runOrchestratedAgent: runOrchestratedAgentMock,
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
  emitOrchestrationEvent: emitOrchestrationEventMock,
}))

vi.mock('../orchestration/active-runs', () => ({
  cancelAllForConversation: cancelAllForConversationMock,
  registerActiveOrchestrationRun: registerActiveOrchestrationRunMock,
  unregisterActiveOrchestrationRun: unregisterActiveOrchestrationRunMock,
}))

vi.mock('../tools/question-manager', () => ({
  answerQuestion: answerQuestionMock,
  cancelQuestion: cancelQuestionMock,
}))

vi.mock('./attachments-handler', () => ({
  hydrateAttachmentSources: hydrateAttachmentSourcesMock,
}))

import { registerAgentHandlers } from './agent-handler'

function getInvokeHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(([channel]) => channel === name)
  return call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined
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

function baseSettings() {
  return {
    ...DEFAULT_SETTINGS,
    orchestrationMode: 'classic' as const,
  }
}

describe('registerAgentHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    typedOnMock.mockReset()
    runAgentMock.mockReset()
    runOrchestratedAgentMock.mockReset()
    getSettingsMock.mockReset()
    getConversationMock.mockReset()
    saveConversationMock.mockReset()
    withConversationLockMock.mockReset()
    emitStreamChunkMock.mockReset()
    emitOrchestrationEventMock.mockReset()
    cancelAllForConversationMock.mockReset()
    registerActiveOrchestrationRunMock.mockReset()
    unregisterActiveOrchestrationRunMock.mockReset()
    answerQuestionMock.mockReset()
    cancelQuestionMock.mockReset()
    hydrateAttachmentSourcesMock.mockReset()
    hydrateAttachmentSourcesMock.mockImplementation(async (attachments: unknown) => attachments)

    withConversationLockMock.mockImplementation(async (_id: unknown, fn: () => Promise<void>) =>
      fn(),
    )
    getSettingsMock.mockReturnValue(baseSettings())
    getConversationMock.mockResolvedValue(baseConversation())
  })

  it('does not persist anything when classic run aborts', async () => {
    runAgentMock.mockRejectedValueOnce(new Error('aborted'))

    registerAgentHandlers()
    const handler = getInvokeHandler('agent:send-message')
    expect(handler).toBeDefined()

    await handler?.(
      {},
      ConversationId('conv-1'),
      {
        text: '',
        qualityPreset: 'medium',
        attachments: [],
      },
      'claude-sonnet-4-5',
    )

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
      finalMessage: {
        id: MessageId('assistant-1'),
        role: 'assistant',
        parts: [{ type: 'text', text: 'noop' }],
        createdAt: Date.now(),
      },
    })

    registerAgentHandlers()
    const handler = getInvokeHandler('agent:send-message')
    expect(handler).toBeDefined()

    await handler?.(
      {},
      ConversationId('conv-1'),
      {
        text: '',
        qualityPreset: 'medium',
        attachments: [],
      },
      'claude-sonnet-4-5',
    )

    expect(withConversationLockMock).not.toHaveBeenCalled()
    expect(saveConversationMock).not.toHaveBeenCalled()
  })
})
