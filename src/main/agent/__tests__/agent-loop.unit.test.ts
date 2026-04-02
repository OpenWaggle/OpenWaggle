import type { Message, MessagePart } from '@shared/types/agent'
import {
  ConversationId,
  createSkipApprovalToken,
  MessageId,
  SupportedModelId,
  ToolCallId,
} from '@shared/types/brand'
import type { DomainUiContinuationMessage } from '@shared/types/continuation'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  chatMock,
  chatStreamMock,
  maxIterationsMock,
  loadProjectConfigMock,
  bindToolContextToToolsMock,
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
  processAgentStreamEffectMock,
  resolveToolContextAttachmentsMock,
} = vi.hoisted(() => {
  const _chatStreamMock = vi.fn()
  return {
    chatMock: vi.fn(),
    chatStreamMock: _chatStreamMock,
    maxIterationsMock: vi.fn(() => 'max-iterations-strategy'),
    loadProjectConfigMock: vi.fn(),
    bindToolContextToToolsMock: vi.fn(),
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
    processAgentStreamEffectMock: vi.fn(),
    resolveToolContextAttachmentsMock: vi.fn(),
  }
})

vi.mock('@tanstack/ai', () => ({
  chat: chatMock,
  maxIterations: maxIterationsMock,
}))

vi.mock('../../config/project-config', () => ({
  loadProjectConfig: loadProjectConfigMock,
}))

vi.mock('../../tools/define-tool', () => ({
  bindToolContextToTools: bindToolContextToToolsMock,
}))

vi.mock('../continuation-normalizer', () => ({
  normalizeContinuationAsUIMessages: normalizeContinuationAsUIMessagesMock,
}))

vi.mock('../lifecycle-hooks', () => ({
  notifyRunComplete: notifyRunCompleteMock,
  notifyRunError: notifyRunErrorMock,
  notifyRunStart: notifyRunStartMock,
}))

vi.mock('../message-mapper', () => ({
  conversationToMessages: conversationToMessagesMock,
}))

vi.mock('../prompt-builder', () => ({
  buildAgentPrompt: buildAgentPromptMock,
}))

vi.mock('../shared', () => ({
  buildPersistedUserMessageParts: buildPersistedUserMessagePartsMock,
  buildSamplingOptions: buildSamplingOptionsMock,
  isResolutionError: isResolutionErrorMock,
  makeMessage: makeMessageMock,
  resolveAgentProjectPath: resolveAgentProjectPathMock,
  resolveProviderAndQuality: resolveProviderAndQualityMock,
}))

vi.mock('../standards-context', () => ({
  loadAgentStandardsContext: loadAgentStandardsContextMock,
}))

// Mock the runtime so runAgent's dynamic import resolves with a test layer
vi.mock('../../runtime', async () => {
  const { Effect, Layer } = await import('effect')
  const { StandardsService } = await import('../../ports/standards-service')
  const { StandardsLoadError } = await import('../../errors')
  const TestStandardsLayer = Layer.succeed(StandardsService, {
    loadContext: () =>
      Effect.tryPromise({
        try: () => loadAgentStandardsContextMock('', '', {}, []),
        catch: (cause) => new StandardsLoadError({ message: String(cause), cause }),
      }),
  })
  return {
    runAppEffect: (effect: Effect.Effect<unknown>) =>
      Effect.runPromise(Effect.provide(effect, TestStandardsLayer)),
  }
})

vi.mock('../stream-processor', () => ({
  processAgentStreamEffect: processAgentStreamEffectMock,
}))

vi.mock('../tool-context-attachments', () => ({
  resolveToolContextAttachments: resolveToolContextAttachmentsMock,
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { runAgent } from '../agent-loop'

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
    chatStreamMock.mockReset()
    chatStreamMock.mockReturnValue(STREAM)
    maxIterationsMock.mockClear()
    loadProjectConfigMock.mockReset()
    bindToolContextToToolsMock.mockReset()
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
    processAgentStreamEffectMock.mockReset()
    resolveToolContextAttachmentsMock.mockReset()

    loadProjectConfigMock.mockResolvedValue({})
    bindToolContextToToolsMock.mockImplementation((tools: unknown) => tools)
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
    processAgentStreamEffectMock.mockReturnValue(
      Effect.succeed({
        aborted: false,
        runErrorNotified: false,
        timedOut: false,
        stallReason: null,
      }),
    )
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
      chatStream: chatStreamMock,
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
      chatStream: chatStreamMock,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(normalizeContinuationAsUIMessagesMock).toHaveBeenCalledOnce()
    expect(result.newMessages.map((message) => message.role)).toEqual(['assistant'])
  })

  it('synthesizes a terminal denied tool-result for denied approval continuations', async () => {
    const deniedContinuationMessages: DomainUiContinuationMessage[] = [
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
      chatStream: chatStreamMock,
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
    const deniedContinuationMessages: DomainUiContinuationMessage[] = [
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
      chatStream: chatStreamMock,
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

  it('restores richer persisted tool args for continuation tool re-executions', async () => {
    processAgentStreamEffectMock.mockImplementationOnce((params) =>
      Effect.sync(() => {
        params.collector.handleChunk({
          type: 'TOOL_CALL_END',
          timestamp: 1,
          toolCallId: 'tool-restore',
          toolName: 'writeFile',
          result: '{"kind":"text","text":"ok"}',
        })

        return {
          aborted: false,
          runErrorNotified: false,
          timedOut: false,
          stallReason: null,
        }
      }),
    )

    const conversation = {
      ...createConversation(),
      messages: [
        createPersistedMessage('assistant', [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-restore'),
              name: 'writeFile',
              args: { path: 'SUMMARY.md', content: 'hello' },
              state: 'approval-requested',
              approval: {
                id: 'approval_tool-restore',
                needsApproval: true,
              },
            },
          },
        ]),
      ],
    }

    const result = await runAgent({
      conversation,
      payload: {
        ...createPayload(),
        continuationMessages: [{ id: 'ui-restore', role: 'assistant', parts: [] }],
      },
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      chatStream: chatStreamMock,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(result.finalMessage.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool-call',
          toolCall: expect.objectContaining({
            id: 'tool-restore',
            args: { path: 'SUMMARY.md', content: 'hello' },
          }),
        }),
        expect.objectContaining({
          type: 'tool-result',
          toolResult: expect.objectContaining({
            id: 'tool-restore',
            args: { path: 'SUMMARY.md', content: 'hello' },
          }),
        }),
      ]),
    )
  })

  it('notifies lifecycle hooks when a non-abort stream failure escapes', async () => {
    // Use a non-retryable error (auth) so it is not caught by provider retry logic
    const boom = new Error('401 Unauthorized: Invalid API key')
    processAgentStreamEffectMock.mockReturnValueOnce(Effect.fail(boom))

    await expect(
      runAgent({
        conversation: createConversation(),
        payload: createPayload(),
        model: MODEL,
        settings: DEFAULT_SETTINGS,
        chatStream: chatStreamMock,
        onChunk: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('401 Unauthorized: Invalid API key')

    expect(notifyRunErrorMock).toHaveBeenCalledOnce()
    expect(notifyRunErrorMock).toHaveBeenCalledWith([], expect.any(Object), boom)
  })

  it('does not notify lifecycle hooks for aborted runs', async () => {
    processAgentStreamEffectMock.mockReturnValueOnce(
      Effect.succeed({
        aborted: true,
        runErrorNotified: false,
        timedOut: false,
        stallReason: null,
      }),
    )

    await expect(
      runAgent({
        conversation: createConversation(),
        payload: createPayload(),
        model: MODEL,
        settings: DEFAULT_SETTINGS,
        chatStream: chatStreamMock,
        onChunk: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('aborted')

    expect(notifyRunErrorMock).not.toHaveBeenCalled()
  })

  it('retries the run when tool args stall before execution begins', async () => {
    processAgentStreamEffectMock
      .mockReturnValueOnce(
        Effect.succeed({
          aborted: false,
          runErrorNotified: false,
          timedOut: true,
          stallReason: 'incomplete-tool-args',
        }),
      )
      .mockReturnValueOnce(
        Effect.succeed({
          aborted: false,
          runErrorNotified: false,
          timedOut: false,
          stallReason: null,
        }),
      )

    const result = await runAgent({
      conversation: createConversation(),
      payload: createPayload(),
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      chatStream: chatStreamMock,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(result.finalMessage.role).toBe('assistant')
    expect(processAgentStreamEffectMock).toHaveBeenCalledTimes(2)
    expect(notifyRunErrorMock).not.toHaveBeenCalled()
    expect(notifyRunCompleteMock).toHaveBeenCalledOnce()
  })

  it('fails the run when a tool call stalls after execution has started', async () => {
    processAgentStreamEffectMock.mockReturnValueOnce(
      Effect.succeed({
        aborted: false,
        runErrorNotified: false,
        timedOut: true,
        stallReason: 'awaiting-tool-result',
      }),
    )

    await expect(
      runAgent({
        conversation: createConversation(),
        payload: createPayload(),
        model: MODEL,
        settings: DEFAULT_SETTINGS,
        chatStream: chatStreamMock,
        onChunk: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('Agent stream stalled before tool execution completed. Please try again.')

    expect(notifyRunErrorMock).toHaveBeenCalledOnce()
    expect(notifyRunCompleteMock).not.toHaveBeenCalled()
  })

  it('retries on retryable provider error and succeeds on second attempt', async () => {
    processAgentStreamEffectMock
      .mockReturnValueOnce(
        Effect.succeed({
          aborted: false,
          runErrorNotified: false,
          timedOut: false,
          stallReason: null,
          providerError: { message: '429 Rate limit exceeded', code: '429' },
        }),
      )
      .mockReturnValueOnce(
        Effect.succeed({
          aborted: false,
          runErrorNotified: false,
          timedOut: false,
          stallReason: null,
        }),
      )

    const result = await runAgent({
      conversation: createConversation(),
      payload: createPayload(),
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      chatStream: chatStreamMock,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(result.finalMessage.role).toBe('assistant')
    expect(processAgentStreamEffectMock).toHaveBeenCalledTimes(2)
    expect(notifyRunErrorMock).not.toHaveBeenCalled()
    expect(notifyRunCompleteMock).toHaveBeenCalledOnce()
  })

  it('fails after exhausting provider retry budget', async () => {
    const retryableResult = {
      aborted: false,
      runErrorNotified: false,
      timedOut: false,
      stallReason: null,
      providerError: { message: '502 Bad Gateway' },
    }

    processAgentStreamEffectMock
      .mockReturnValueOnce(Effect.succeed(retryableResult))
      .mockReturnValueOnce(Effect.succeed(retryableResult))
      .mockReturnValueOnce(Effect.succeed(retryableResult))

    await expect(
      runAgent({
        conversation: createConversation(),
        payload: createPayload(),
        model: MODEL,
        settings: DEFAULT_SETTINGS,
        chatStream: chatStreamMock,
        onChunk: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('502 Bad Gateway')

    // First attempt + 2 retries = 3 calls
    expect(processAgentStreamEffectMock).toHaveBeenCalledTimes(3)
    expect(notifyRunErrorMock).toHaveBeenCalledOnce()
  })

  it('retries on thrown retryable error from non-OAuth adapters', async () => {
    processAgentStreamEffectMock
      .mockReturnValueOnce(Effect.fail(new Error('429 Too Many Requests')))
      .mockReturnValueOnce(
        Effect.succeed({
          aborted: false,
          runErrorNotified: false,
          timedOut: false,
          stallReason: null,
        }),
      )

    const result = await runAgent({
      conversation: createConversation(),
      payload: createPayload(),
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      chatStream: chatStreamMock,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(result.finalMessage.role).toBe('assistant')
    expect(processAgentStreamEffectMock).toHaveBeenCalledTimes(2)
    expect(notifyRunErrorMock).not.toHaveBeenCalled()
  })

  it('does not retry non-retryable thrown errors', async () => {
    processAgentStreamEffectMock.mockReturnValueOnce(
      Effect.fail(new Error('401 Unauthorized: Invalid API key')),
    )

    await expect(
      runAgent({
        conversation: createConversation(),
        payload: createPayload(),
        model: MODEL,
        settings: DEFAULT_SETTINGS,
        chatStream: chatStreamMock,
        onChunk: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('401 Unauthorized: Invalid API key')

    expect(processAgentStreamEffectMock).toHaveBeenCalledTimes(1)
    expect(notifyRunErrorMock).toHaveBeenCalledOnce()
  })

  it('does not retry non-retryable in-stream provider errors', async () => {
    processAgentStreamEffectMock.mockReturnValueOnce(
      Effect.succeed({
        aborted: false,
        runErrorNotified: false,
        timedOut: false,
        stallReason: null,
        providerError: { message: '401 Unauthorized: Invalid API key' },
      }),
    )

    await expect(
      runAgent({
        conversation: createConversation(),
        payload: createPayload(),
        model: MODEL,
        settings: DEFAULT_SETTINGS,
        chatStream: chatStreamMock,
        onChunk: vi.fn(),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('401 Unauthorized: Invalid API key')

    expect(processAgentStreamEffectMock).toHaveBeenCalledTimes(1)
    expect(notifyRunErrorMock).toHaveBeenCalledOnce()
  })

  it('provider retry counter is independent from stall retry counter', async () => {
    processAgentStreamEffectMock
      // First: stall retry
      .mockReturnValueOnce(
        Effect.succeed({
          aborted: false,
          runErrorNotified: false,
          timedOut: true,
          stallReason: 'stream-stall',
        }),
      )
      // Second: provider error after stall retry
      .mockReturnValueOnce(
        Effect.succeed({
          aborted: false,
          runErrorNotified: false,
          timedOut: false,
          stallReason: null,
          providerError: { message: '429 Rate limit exceeded' },
        }),
      )
      // Third: success after provider retry
      .mockReturnValueOnce(
        Effect.succeed({
          aborted: false,
          runErrorNotified: false,
          timedOut: false,
          stallReason: null,
        }),
      )

    const result = await runAgent({
      conversation: createConversation(),
      payload: createPayload(),
      model: MODEL,
      settings: DEFAULT_SETTINGS,
      chatStream: chatStreamMock,
      onChunk: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(result.finalMessage.role).toBe('assistant')
    expect(processAgentStreamEffectMock).toHaveBeenCalledTimes(3)
    expect(notifyRunErrorMock).not.toHaveBeenCalled()
  })
})
