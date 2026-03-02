import { ConversationId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { JsonValue } from '@shared/types/json'
import type { Settings } from '@shared/types/settings'
import type { StreamChunk } from '@tanstack/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runOpenWaggleOrchestrationMock,
  resolveProviderAndQualityMock,
  chatMock,
  gatherProjectContextMock,
  createExecutorToolsMock,
  maxIterationsMock,
  loadProjectConfigMock,
} = vi.hoisted(() => ({
  runOpenWaggleOrchestrationMock: vi.fn(),
  resolveProviderAndQualityMock: vi.fn(),
  chatMock: vi.fn(),
  gatherProjectContextMock: vi.fn(),
  createExecutorToolsMock: vi.fn(),
  maxIterationsMock: vi.fn(),
  loadProjectConfigMock: vi.fn(),
}))

vi.mock('./engine', () => ({
  runOpenWaggleOrchestration: runOpenWaggleOrchestrationMock,
  extractJson: vi.fn(),
}))

vi.mock('@tanstack/ai', () => ({
  chat: chatMock,
  maxIterations: maxIterationsMock,
}))

vi.mock('../agent/shared', () => ({
  resolveProviderAndQuality: resolveProviderAndQualityMock,
  isResolutionError: (result: { ok: boolean }) => !result.ok,
  buildPersistedUserMessageParts: vi.fn(),
  buildSamplingOptions: vi.fn(),
  makeMessage: vi.fn(),
}))

vi.mock('./project-context', () => ({
  gatherProjectContext: gatherProjectContextMock,
  createExecutorTools: createExecutorToolsMock,
}))

vi.mock('../config/project-config', () => ({
  loadProjectConfig: loadProjectConfigMock,
}))

import { runOrchestratedAgent } from './service'

// --- Stream chunk helpers ---

async function* createStreamChunks(text: string): AsyncGenerator<StreamChunk> {
  yield { type: 'TEXT_MESSAGE_CONTENT', timestamp: Date.now(), messageId: 'msg-1', delta: text }
  yield { type: 'RUN_FINISHED', timestamp: Date.now(), runId: 'run-1', finishReason: 'stop' }
}

async function* createStreamChunksWithThinking(
  thinking: string,
  text: string,
): AsyncGenerator<StreamChunk> {
  yield { type: 'STEP_STARTED', timestamp: Date.now(), stepId: 'step-1' }
  yield { type: 'STEP_FINISHED', timestamp: Date.now(), stepId: 'step-1', delta: thinking }
  yield { type: 'TEXT_MESSAGE_CONTENT', timestamp: Date.now(), messageId: 'msg-1', delta: text }
  yield { type: 'RUN_FINISHED', timestamp: Date.now(), runId: 'run-1', finishReason: 'stop' }
}

async function* createRunErrorStream(
  code = 'rate_limit_error',
  message = 'Rate limit exceeded',
): AsyncGenerator<StreamChunk> {
  yield {
    type: 'RUN_ERROR',
    timestamp: Date.now(),
    model: 'test-model',
    error: { code, message },
  } as StreamChunk
}

function createErrorStream(error: Error): AsyncIterable<StreamChunk> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<StreamChunk>> {
          return Promise.reject(error)
        },
      }
    },
  }
}

// --- Fixtures ---

const MOCK_CONTEXT_TEXT =
  '## Project Context\n\n### Tech Stack\nProject: test-app\nStack: TypeScript, React'

function createSettings(): Settings {
  return {
    providers: {
      openai: {
        apiKey: 'test-key',
        enabled: true,
      },
    },
    defaultModel: SupportedModelId('gpt-4.1-mini'),
    favoriteModels: [],
    projectPath: '/tmp/project',
    executionMode: 'full-access',
    qualityPreset: 'medium',
    recentProjects: [],
    skillTogglesByProject: {},
    mcpServers: [],
    projectDisplayNames: {},
    encryptionAvailable: true,
    apiKeysRequireManualResave: false,
  }
}

function createConversation(): Conversation {
  const now = Date.now()
  return {
    id: ConversationId('conversation-1'),
    title: 'Thread',
    projectPath: '/tmp/project',
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

describe('runOrchestratedAgent', () => {
  beforeEach(() => {
    runOpenWaggleOrchestrationMock.mockReset()
    resolveProviderAndQualityMock.mockReset()
    chatMock.mockReset()
    gatherProjectContextMock.mockReset()
    createExecutorToolsMock.mockReset()
    maxIterationsMock.mockReset()
    loadProjectConfigMock.mockReset()
    loadProjectConfigMock.mockResolvedValue({})

    resolveProviderAndQualityMock.mockReturnValue({
      ok: true,
      provider: {
        id: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        supportsBaseUrl: true,
        supportsSubscription: true,
        supportsDynamicModelFetch: false,
        models: ['gpt-4.1-mini'],
        testModel: 'gpt-4.1-mini',
        createAdapter: vi.fn(() => ({}) as never),
      },
      providerConfig: {
        apiKey: 'test-key',
        enabled: true,
      },
      resolvedModel: 'gpt-4.1-mini',
      qualityConfig: {
        model: SupportedModelId('gpt-4.1-mini'),
        temperature: 0.4,
        topP: 0.95,
        maxTokens: 2200,
      },
    })

    gatherProjectContextMock.mockResolvedValue({
      text: MOCK_CONTEXT_TEXT,
      rawLength: MOCK_CONTEXT_TEXT.length,
      durationMs: 5,
    })

    createExecutorToolsMock.mockResolvedValue([])
    maxIterationsMock.mockReturnValue(undefined)
  })

  it('returns fallback immediately when model resolution fails', async () => {
    resolveProviderAndQualityMock.mockReturnValue({
      ok: false,
      reason: 'missing API key',
    })

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Help me',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
    })

    expect(result).toEqual({
      status: 'fallback',
      runId: 'run-1',
      reason: 'missing API key',
    })
    expect(emitChunk).not.toHaveBeenCalled()
    expect(chatMock).not.toHaveBeenCalled()
    expect(runOpenWaggleOrchestrationMock).not.toHaveBeenCalled()
  })

  it('returns fallback when setup fails before stream starts', async () => {
    resolveProviderAndQualityMock.mockReturnValue({
      ok: true,
      provider: {
        id: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        supportsBaseUrl: true,
        supportsSubscription: true,
        supportsDynamicModelFetch: false,
        models: ['gpt-4.1-mini'],
        testModel: 'gpt-4.1-mini',
        createAdapter: vi.fn(() => {
          throw new Error('adapter init failed')
        }),
      },
      providerConfig: {
        apiKey: 'test-key',
        enabled: true,
      },
      resolvedModel: 'gpt-4.1-mini',
      qualityConfig: {
        model: SupportedModelId('gpt-4.1-mini'),
        temperature: 0.4,
        topP: 0.95,
        maxTokens: 2200,
      },
    })

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Help me',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
    })

    expect(result).toEqual({
      status: 'fallback',
      runId: 'run-1',
      reason: 'adapter init failed',
    })
    expect(emitChunk).not.toHaveBeenCalled()
    expect(chatMock).not.toHaveBeenCalled()
    expect(runOpenWaggleOrchestrationMock).not.toHaveBeenCalled()
  })

  it('returns cancelled when setup aborts before stream starts', async () => {
    loadProjectConfigMock.mockRejectedValue(new Error('aborted'))

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Help me',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
    })

    expect(result).toEqual({
      status: 'cancelled',
      runId: 'run-1',
      newMessages: [],
    })
    expect(emitChunk).not.toHaveBeenCalled()
    expect(chatMock).not.toHaveBeenCalled()
    expect(runOpenWaggleOrchestrationMock).not.toHaveBeenCalled()
  })

  it('emits TEXT_MESSAGE_END but not RUN_FINISHED when fallback after partial text', async () => {
    const planTasks = {
      ackText: 'Working on it.',
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    runOpenWaggleOrchestrationMock.mockResolvedValue({
      runId: 'run-1',
      usedFallback: true,
      fallbackReason: 'executor timeout',
      text: '',
      runStatus: 'completed',
    })

    const emitChunk = vi.fn()
    const emitEvent = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Help me', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent,
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('fallback')
    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    // Message was started (ack text streamed), so TEXT_MESSAGE_END is emitted
    expect(chunkTypes).toContain('TEXT_MESSAGE_START')
    expect(chunkTypes).toContain('TEXT_MESSAGE_END')
    // But no RUN_FINISHED — classic fallback agent handles that
    expect(chunkTypes).not.toContain('RUN_FINISHED')
  })

  it('includes project context in executor prompt', async () => {
    const planTasks: JsonValue = {
      tasks: [
        { id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' },
        {
          id: 'task-2',
          kind: 'synthesis',
          title: 'Synthesize',
          prompt: 'Combine',
          dependsOn: ['task-1'],
        },
      ],
    }
    chatMock.mockImplementation(() => createStreamChunks('Executor output'))
    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: { executor: { execute: (arg: unknown) => Promise<unknown> } }) => {
        // Call the executor to verify its prompt includes context
        await input.executor.execute({
          task: { title: 'Task 1', kind: 'general', prompt: 'Do thing 1' },
          orchestrationTask: {},
          includeConversationSummary: false,
          maxContextTokens: 1500,
          dependencyOutputs: {},
          signal: new AbortController().signal,
        })
        return {
          runId: 'run-1',
          usedFallback: false,
          text: 'Done',
          runStatus: 'completed',
        }
      },
    )

    await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Analyze my codebase',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk: vi.fn(),
      planJson: planTasks,
    })

    // Executor chat call includes project context
    expect(chatMock.mock.calls.length).toBeGreaterThanOrEqual(1)
    const executorCall = chatMock.mock.calls[0]
    const executorMessages = executorCall[0].messages as Array<{ content: string }>
    expect(executorMessages[0].content).toContain('## Project Context')
    expect(executorMessages[0].content).toContain('Project: test-app')
    expect(executorMessages[0].content).toContain('readFile')
    expect(executorMessages[0].content).toContain('webFetch')
  })

  it('runs orchestration when planJson provides tasks', async () => {
    const planTasks: JsonValue = {
      ackText: 'Analyzing your codebase now.',
      tasks: [
        { id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' },
        {
          id: 'task-2',
          kind: 'synthesis',
          title: 'Synthesize',
          prompt: 'Combine',
          dependsOn: ['task-1'],
        },
      ],
    }
    runOpenWaggleOrchestrationMock.mockResolvedValue({
      runId: 'run-1',
      usedFallback: false,
      text: 'Final synthesis result',
      runStatus: 'completed',
    })

    const emitChunk = vi.fn()
    const emitEvent = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Analyze my codebase',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent,
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('completed')
    expect(runOpenWaggleOrchestrationMock).toHaveBeenCalledTimes(1)
    // Should have emitted ack text
    const ackContent = emitChunk.mock.calls.find((c) => {
      const chunk = c[0] as { type: string; delta?: string }
      return chunk.type === 'TEXT_MESSAGE_CONTENT' && chunk.delta && chunk.delta.length > 0
    })
    expect(ackContent).toBeTruthy()
  })

  it('returns cancelled when orchestration engine reports cancelled status', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    runOpenWaggleOrchestrationMock.mockResolvedValue({
      runId: 'run-1',
      usedFallback: false,
      text: '',
      runStatus: 'cancelled',
    })

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(result).toEqual({
      status: 'cancelled',
      runId: 'run-1',
      newMessages: [],
    })
    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(chunkTypes).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
  })

  it('passes executor tools to createExecutorTools with project path', async () => {
    runOpenWaggleOrchestrationMock.mockResolvedValue({
      runId: 'run-1',
      usedFallback: false,
      text: '',
      runStatus: 'completed',
    })

    await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Test',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk: vi.fn(),
      planJson: { tasks: [] },
    })

    expect(createExecutorToolsMock).toHaveBeenCalledWith('/tmp/project', expect.any(Object))
  })

  it('does not forward STEP events from executor to emitChunk', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    chatMock.mockImplementation(() =>
      createStreamChunksWithThinking('Reasoning about task...', 'Task result.'),
    )
    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: { executor: { execute: (arg: unknown) => Promise<unknown> } }) => {
        await input.executor.execute({
          task: { title: 'Task 1', kind: 'general', prompt: 'Do thing 1' },
          orchestrationTask: {},
          includeConversationSummary: false,
          maxContextTokens: 1500,
          dependencyOutputs: {},
          signal: new AbortController().signal,
        })
        return {
          runId: 'run-1',
          usedFallback: false,
          text: 'Final result',
          runStatus: 'completed',
        }
      },
    )

    const emitChunk = vi.fn()

    await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    // Executor STEP events must NOT reach the renderer — they carry accumulated
    // text/thinking content that corrupts useChat's message state.
    // StreamSession manages all renderer-facing AG-UI protocol events.
    const stepFinished = emitChunk.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'STEP_FINISHED',
    )
    expect(stepFinished.length).toBe(0)
  })

  it('modelTextWithTools throws when executor stream contains RUN_ERROR', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    chatMock.mockImplementation(() => createRunErrorStream('server_error', 'Internal server error'))
    let executorError: Error | undefined
    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: { executor: { execute: (arg: unknown) => Promise<unknown> } }) => {
        try {
          await input.executor.execute({
            task: { title: 'Task 1', kind: 'general', prompt: 'Do thing 1' },
            orchestrationTask: {},
            includeConversationSummary: false,
            maxContextTokens: 1500,
            dependencyOutputs: {},
            signal: new AbortController().signal,
          })
        } catch (e) {
          executorError = e as Error
        }
        return {
          runId: 'run-1',
          usedFallback: false,
          text: 'Fallback text',
          runStatus: 'completed',
        }
      },
    )

    const emitChunk = vi.fn()

    await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(chatMock).toHaveBeenCalledTimes(1)
    expect(executorError).toBeDefined()
    expect(executorError?.message).toContain('server_error')
    expect(executorError?.message).toContain('Internal server error')
  })

  it('returns cancelled when executor path aborts after ack text is streamed', async () => {
    const planTasks = {
      ackText: 'Working on it.',
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    chatMock.mockImplementation(() => createErrorStream(new Error('aborted')))
    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: { executor: { execute: (arg: unknown) => Promise<unknown> } }) => {
        await input.executor.execute({
          task: { id: 'task-1', title: 'Task 1', kind: 'general', prompt: 'Do thing 1' },
          orchestrationTask: {},
          includeConversationSummary: false,
          maxContextTokens: 1500,
          dependencyOutputs: {},
          signal: new AbortController().signal,
        })
        return {
          runId: 'run-1',
          usedFallback: false,
          text: '',
          runStatus: 'completed',
        }
      },
    )

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('cancelled')
    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(chunkTypes).toContain('TEXT_MESSAGE_START')
    expect(chunkTypes).toContain('TEXT_MESSAGE_END')
    expect(chunkTypes).toContain('RUN_FINISHED')
    const content = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
      .join('')
    expect(content).not.toContain('Falling back to direct execution')
  })

  it('ignores malformed task progress payloads without failing the run', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: {
        onEvent?: (event: {
          type: string
          runId: string
          taskId?: string
          at: string
          payload?: unknown
        }) => Promise<void>
      }) => {
        await input.onEvent?.({
          type: 'task_progress',
          runId: 'run-1',
          taskId: 'task-1',
          at: new Date().toISOString(),
          payload: { type: 'tool_end' },
        })
        await input.onEvent?.({
          type: 'task_succeeded',
          runId: 'run-1',
          taskId: 'task-1',
          at: new Date().toISOString(),
        })
        return {
          runId: 'run-1',
          usedFallback: false,
          text: 'Done',
          runStatus: 'completed',
        }
      },
    )

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('completed')
    const content = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
      .join('')
    expect(content).toContain('✓ Task 1')
  })

  it('emits task narration when orchestration reports task_started', async () => {
    const planTasks = {
      tasks: [
        {
          id: 'task-1',
          kind: 'general',
          title: 'Task 1',
          prompt: 'Do thing 1',
          narration: 'Let me inspect the repository structure first.',
        },
      ],
    }
    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: {
        onEvent?: (event: {
          type: string
          runId: string
          taskId?: string
          at: string
        }) => Promise<void>
      }) => {
        await input.onEvent?.({
          type: 'task_started',
          runId: 'run-1',
          taskId: 'task-1',
          at: new Date().toISOString(),
        })
        return {
          runId: 'run-1',
          usedFallback: false,
          text: 'Done',
          runStatus: 'completed',
        }
      },
    )

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('completed')
    const content = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
      .join('')
    expect(content).toContain('Let me inspect the repository structure first.')
  })

  it('emits "Working on: <title>" when task_started has no narration', async () => {
    const planTasks = {
      tasks: [
        {
          id: 'task-1',
          kind: 'general',
          title: 'Analyze dependencies',
          prompt: 'Check package.json',
          // No narration field — should fall back to title
        },
      ],
    }
    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: {
        onEvent?: (event: {
          type: string
          runId: string
          taskId?: string
          at: string
        }) => Promise<void>
      }) => {
        await input.onEvent?.({
          type: 'task_started',
          runId: 'run-1',
          taskId: 'task-1',
          at: new Date().toISOString(),
        })
        return {
          runId: 'run-1',
          usedFallback: false,
          text: 'Done',
          runStatus: 'completed',
        }
      },
    )

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('completed')
    const content = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
      .join('')
    expect(content).toContain('Working on: Analyze dependencies')
  })

  it('synthesis streams text in real-time through StreamSession', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    // First call: executor produces output
    // Second call: synthesis produces streamed text
    let callCount = 0
    chatMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return createStreamChunks('Executor output text')
      }
      // Synthesis call — returns text that should be streamed via StreamSession
      return createStreamChunks('Synthesized final answer.')
    })
    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: {
        executor: { execute: (arg: unknown) => Promise<unknown> }
        synthesizer: {
          synthesize: (arg: { run: { outputs: Record<string, unknown> } }) => Promise<string>
        }
      }) => {
        await input.executor.execute({
          task: { title: 'Task 1', kind: 'general', prompt: 'Do thing 1' },
          orchestrationTask: {},
          includeConversationSummary: false,
          maxContextTokens: 1500,
          dependencyOutputs: {},
          signal: new AbortController().signal,
        })
        const text = await input.synthesizer.synthesize({
          run: { outputs: { 'task-1': { text: 'Task 1 output' } } },
        })
        return {
          runId: 'run-1',
          usedFallback: false,
          text,
          runStatus: 'completed',
        }
      },
    )

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('completed')
    const contentChunks = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
    const fullContent = contentChunks.join('')
    // Synthesis divider and text should be present
    expect(fullContent).toContain('---')
    expect(fullContent).toContain('Synthesized final answer.')
  })

  it('does not emit duplicate divider when synthesis already streamed', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }

    runOpenWaggleOrchestrationMock.mockImplementation(
      async (input: {
        synthesizer: {
          synthesize: (arg: { run: { outputs: Record<string, unknown> } }) => Promise<string>
        }
      }) => {
        // Synthesizer callback runs and sets synthesisDone = true internally
        const text = await input.synthesizer.synthesize({
          run: { outputs: { 'task-1': { text: 'Task 1 output' } } },
        })
        return {
          runId: 'run-1',
          usedFallback: false,
          // Return the same text as the synthesizer produced
          text,
          runStatus: 'completed',
        }
      },
    )

    // Synthesis chat call
    chatMock.mockImplementation(() => createStreamChunks('Synthesized text'))

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('completed')
    const contentChunks = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
    const fullContent = contentChunks.join('')
    // The divider '---' should appear exactly once (from the synthesizer callback),
    // NOT twice (which would happen if the post-orchestration guard failed)
    const dividerCount = fullContent.split('---').length - 1
    expect(dividerCount).toBe(1)
  })

  it('synthesis falls back to concatenated outputs on empty result', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    // Simulate runOpenWaggleOrchestration returning empty text (synthesis returned empty)
    runOpenWaggleOrchestrationMock.mockResolvedValue({
      runId: 'run-1',
      usedFallback: false,
      text: '',
      runStatus: 'completed',
    })

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    // Even with empty synthesis, the run should complete (not crash)
    expect(result.status).toBe('completed')
    // With empty synthesis text, no divider should be emitted (nothing to separate)
    const contentChunks = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
    expect(contentChunks.join('')).not.toContain('---')
  })

  it('includes task title in failure message', async () => {
    const planTasks = {
      tasks: [
        { id: 'task-1', kind: 'general', title: 'Analyze config', prompt: 'Read config files' },
      ],
    }
    runOpenWaggleOrchestrationMock.mockResolvedValue({
      runId: 'run-1',
      usedFallback: false,
      text: '',
      runStatus: 'failed',
      run: {
        taskOrder: ['task-1'],
        tasks: {
          'task-1': {
            id: 'task-1',
            status: 'failed',
            error: 'API timeout',
          },
        },
      },
    })

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze my config', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
      planJson: planTasks,
    })

    expect(result.status).toBe('failed')
    // The failure message should include the task title
    expect(result.reason).toContain('Analyze config')
    expect(result.reason).toContain('API timeout')
    // Also streamed to the user
    const contentChunks = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
    expect(contentChunks.join('')).toContain('Analyze config')
  })
})
