import type { Message, MessagePart } from '@shared/types/agent'
import {
  ConversationId,
  createSkipApprovalToken,
  MessageId,
  SupportedModelId,
} from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { UIMessage } from '@tanstack/ai-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  chatMock,
  maxIterationsMock,
  loadProjectConfigMock,
  runWithToolContextMock,
  normalizeContinuationAsUIMessagesMock,
  notifyRunCompleteMock,
  notifyRunErrorMock,
  notifyRunStartMock,
  conversationToMessagesMock,
  buildAgentPromptMock,
  buildPersistedUserMessagePartsMock,
  buildSamplingOptionsMock,
  isResolutionErrorMock,
  makeMessageMock,
  resolveAgentProjectPathMock,
  resolveProviderAndQualityMock,
  loadAgentStandardsContextMock,
  processAgentStreamMock,
  resolveToolContextAttachmentsMock,
} = vi.hoisted(() => ({
  chatMock: vi.fn(),
  maxIterationsMock: vi.fn(() => 'max-iterations-strategy'),
  loadProjectConfigMock: vi.fn(),
  runWithToolContextMock: vi.fn(),
  normalizeContinuationAsUIMessagesMock: vi.fn(),
  notifyRunCompleteMock: vi.fn(),
  notifyRunErrorMock: vi.fn(),
  notifyRunStartMock: vi.fn(),
  conversationToMessagesMock: vi.fn(),
  buildAgentPromptMock: vi.fn(),
  buildPersistedUserMessagePartsMock: vi.fn(),
  buildSamplingOptionsMock: vi.fn(),
  isResolutionErrorMock: vi.fn(),
  makeMessageMock: vi.fn(),
  resolveAgentProjectPathMock: vi.fn(),
  resolveProviderAndQualityMock: vi.fn(),
  loadAgentStandardsContextMock: vi.fn(),
  processAgentStreamMock: vi.fn(),
  resolveToolContextAttachmentsMock: vi.fn(),
}))

vi.mock('@tanstack/ai', () => ({
  chat: chatMock,
  maxIterations: maxIterationsMock,
}))

vi.mock('../config/project-config', () => ({
  loadProjectConfig: loadProjectConfigMock,
}))

vi.mock('../tools/define-tool', () => ({
  runWithToolContext: runWithToolContextMock,
}))

vi.mock('./continuation-normalizer', () => ({
  normalizeContinuationAsUIMessages: normalizeContinuationAsUIMessagesMock,
}))

vi.mock('./lifecycle-hooks', () => ({
  notifyRunComplete: notifyRunCompleteMock,
  notifyRunError: notifyRunErrorMock,
  notifyRunStart: notifyRunStartMock,
}))

vi.mock('./message-mapper', () => ({
  conversationToMessages: conversationToMessagesMock,
}))

vi.mock('./prompt-builder', () => ({
  buildAgentPrompt: buildAgentPromptMock,
}))

vi.mock('./shared', () => ({
  buildPersistedUserMessageParts: buildPersistedUserMessagePartsMock,
  buildSamplingOptions: buildSamplingOptionsMock,
  isResolutionError: isResolutionErrorMock,
  makeMessage: makeMessageMock,
  resolveAgentProjectPath: resolveAgentProjectPathMock,
  resolveProviderAndQuality: resolveProviderAndQualityMock,
}))

vi.mock('./standards-context', () => ({
  loadAgentStandardsContext: loadAgentStandardsContextMock,
}))

vi.mock('./stream-processor', () => ({
  processAgentStream: processAgentStreamMock,
}))

vi.mock('./tool-context-attachments', () => ({
  resolveToolContextAttachments: resolveToolContextAttachmentsMock,
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { runAgent } from './agent-loop'

const PROJECT_PATH = '/repo'
const MODEL = SupportedModelId('claude-sonnet-4-5')
const STREAM = Symbol('stream')

function createConversation(): Conversation {
  return {
    id: ConversationId('conv-1'),
    title: 'Test conversation',
    projectPath: PROJECT_PATH,
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function createPayload() {
  return {
    text: 'Investigate the issue',
    qualityPreset: 'medium' as const,
    attachments: [],
  }
}

function createPersistedMessage(
  role: Message['role'],
  parts: readonly MessagePart[],
  model?: string,
): Message {
  return {
    id: MessageId(`${role}-${Math.random().toString(16).slice(2)}`),
    role,
    parts,
    ...(model ? { model: SupportedModelId(model) } : {}),
    createdAt: Date.now(),
  }
}

describe('runAgent', () => {
  beforeEach(() => {
    chatMock.mockReset()
    maxIterationsMock.mockClear()
    loadProjectConfigMock.mockReset()
    runWithToolContextMock.mockReset()
    normalizeContinuationAsUIMessagesMock.mockReset()
    notifyRunCompleteMock.mockReset()
    notifyRunErrorMock.mockReset()
    notifyRunStartMock.mockReset()
    conversationToMessagesMock.mockReset()
    buildAgentPromptMock.mockReset()
    buildPersistedUserMessagePartsMock.mockReset()
    buildSamplingOptionsMock.mockReset()
    isResolutionErrorMock.mockReset()
    makeMessageMock.mockReset()
    resolveAgentProjectPathMock.mockReset()
    resolveProviderAndQualityMock.mockReset()
    loadAgentStandardsContextMock.mockReset()
    processAgentStreamMock.mockReset()
    resolveToolContextAttachmentsMock.mockReset()

    loadProjectConfigMock.mockResolvedValue({})
    runWithToolContextMock.mockImplementation(
      async (_context: unknown, fn: () => Promise<unknown>) => fn(),
    )
    normalizeContinuationAsUIMessagesMock.mockReturnValue([])
    conversationToMessagesMock.mockReturnValue([])
    buildAgentPromptMock.mockResolvedValue({
      systemPrompt: 'System prompt',
      tools: [],
      hooks: [],
      promptFragmentIds: ['base'],
    })
    buildPersistedUserMessagePartsMock.mockImplementation((payload: { text: string }) => [
      { type: 'text', text: payload.text },
    ])
    buildSamplingOptionsMock.mockReturnValue({})
    isResolutionErrorMock.mockReturnValue(false)
    resolveAgentProjectPathMock.mockReturnValue(PROJECT_PATH)
    loadAgentStandardsContextMock.mockResolvedValue({
      warnings: [],
      activation: { selectedSkillIds: [] },
      agentsResolvedFiles: [],
    })
    resolveToolContextAttachmentsMock.mockReturnValue([])
    processAgentStreamMock.mockResolvedValue({
      aborted: false,
      runErrorNotified: false,
      timedOut: false,
      stallReason: null,
    })
    chatMock.mockReturnValue(STREAM)

    const provider = {
      id: 'anthropic',
      displayName: 'Anthropic',
      requiresApiKey: true,
      supportsBaseUrl: false,
      supportsSubscription: false,
      supportsDynamicModelFetch: false,
      models: [MODEL],
      testModel: MODEL,
      supportsAttachment: vi.fn(() => false),
      createAdapter: vi.fn(() => ({ adapter: 'ok' })),
    }
    resolveProviderAndQualityMock.mockResolvedValue({
      provider,
      providerConfig: {
        apiKey: 'test-key',
      },
      resolvedModel: MODEL,
      qualityConfig: {
        maxTokens: 2048,
      },
    })

    makeMessageMock.mockImplementation(
      (role: Message['role'], parts: readonly MessagePart[], model?: string): Message =>
        createPersistedMessage(role, parts, model),
    )
  })

  it('returns persisted user and assistant messages for a fresh run', async () => {
    const result = await runAgent({
      conversation: createConversation(),
      payload: createPayload(),
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
      skipApproval: createSkipApprovalToken(),
    })

    expect(result.newMessages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(result.finalMessage.role).toBe('assistant')
    expect(buildPersistedUserMessagePartsMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Investigate the issue' }),
    )
    expect(notifyRunStartMock).toHaveBeenCalledOnce()
    expect(notifyRunCompleteMock).toHaveBeenCalledOnce()
    expect(notifyRunErrorMock).not.toHaveBeenCalled()
  })

  it('returns only the assistant message for continuation runs', async () => {
    const result = await runAgent({
      conversation: createConversation(),
      payload: {
        ...createPayload(),
        continuationMessages: [{ id: 'ui-1', role: 'assistant', parts: [] }],
      },
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(normalizeContinuationAsUIMessagesMock).toHaveBeenCalledOnce()
    expect(result.newMessages.map((message) => message.role)).toEqual(['assistant'])
  })

  it('synthesizes a terminal denied tool-result for denied approval continuations', async () => {
    const deniedContinuationMessages: UIMessage[] = [
      {
        id: 'assistant-denied',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-denied',
            name: 'writeFile',
            arguments: '{"path":"denied.txt"}',
            state: 'approval-responded',
            approval: {
              id: 'approval_tool-denied',
              needsApproval: true,
              approved: false,
            },
          },
        ],
      },
    ]
    normalizeContinuationAsUIMessagesMock.mockReturnValueOnce(deniedContinuationMessages)

    const result = await runAgent({
      conversation: createConversation(),
      payload: {
        ...createPayload(),
        continuationMessages: deniedContinuationMessages,
      },
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(result.finalMessage.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-call',
          toolCall: expect.objectContaining({
            id: 'tool-denied',
            name: 'writeFile',
            args: { path: 'denied.txt' },
          }),
        }),
        expect.objectContaining({
          type: 'tool-result',
          toolResult: expect.objectContaining({
            id: 'tool-denied',
            name: 'writeFile',
            args: { path: 'denied.txt' },
            isError: true,
            result: JSON.stringify({
              approved: false,
              message: 'User declined tool execution',
            }),
          }),
        }),
      ]),
    )
  })

  it('does not re-synthesize a denied approval when the continuation already includes a denied tool-result', async () => {
    const deniedContinuationMessages: UIMessage[] = [
      {
        id: 'assistant-denied',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-denied',
            name: 'writeFile',
            arguments: '{"path":"denied.txt"}',
            state: 'approval-responded',
            approval: {
              id: 'approval_tool-denied',
              needsApproval: true,
              approved: false,
            },
          },
          {
            type: 'tool-result',
            toolCallId: 'tool-denied',
            content: JSON.stringify({
              approved: false,
              message: 'User declined tool execution',
            }),
            state: 'complete',
          },
        ],
      },
    ]
    normalizeContinuationAsUIMessagesMock.mockReturnValueOnce(deniedContinuationMessages)

    const result = await runAgent({
      conversation: createConversation(),
      payload: {
        ...createPayload(),
        continuationMessages: deniedContinuationMessages,
      },
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(
      result.finalMessage.parts.some(
        (part) =>
          (part.type === 'tool-result' || part.type === 'tool-call') &&
          (part.type === 'tool-result'
            ? String(part.toolResult.id) === 'tool-denied'
            : String(part.toolCall.id) === 'tool-denied'),
      ),
    ).toBe(false)
  })

  it('notifies lifecycle hooks when a non-abort stream failure escapes', async () => {
    const boom = new Error('stream exploded')
    processAgentStreamMock.mockRejectedValueOnce(boom)

    await expect(
      runAgent({
        conversation: createConversation(),
        payload: createPayload(),
        model: MODEL,
        settings: DEFAULT_SETTINGS,
        onChunk: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('stream exploded')

    expect(notifyRunErrorMock).toHaveBeenCalledOnce()
    expect(notifyRunErrorMock).toHaveBeenCalledWith([], expect.any(Object), boom)
  })

  it('does not notify lifecycle hooks for aborted runs', async () => {
    processAgentStreamMock.mockResolvedValueOnce({
      aborted: true,
      runErrorNotified: false,
      timedOut: false,
      stallReason: null,
    })

    await expect(
      runAgent({
        conversation: createConversation(),
        payload: createPayload(),
        model: MODEL,
        settings: DEFAULT_SETTINGS,
        onChunk: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('aborted')

    expect(notifyRunErrorMock).not.toHaveBeenCalled()
  })
})
