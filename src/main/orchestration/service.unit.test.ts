import { ConversationId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import type { StreamChunk } from '@tanstack/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runOpenWaggleOrchestrationMock,
  resolveProviderAndQualityMock,
  extractJsonMock,
  chatMock,
  gatherProjectContextMock,
  createExecutorToolsMock,
  maxIterationsMock,
  loadProjectConfigMock,
} = vi.hoisted(() => ({
  runOpenWaggleOrchestrationMock: vi.fn(),
  resolveProviderAndQualityMock: vi.fn(),
  extractJsonMock: vi.fn(),
  chatMock: vi.fn(),
  gatherProjectContextMock: vi.fn(),
  createExecutorToolsMock: vi.fn(),
  maxIterationsMock: vi.fn(),
  loadProjectConfigMock: vi.fn(),
}))

vi.mock('./engine', () => ({
  runOpenWaggleOrchestration: runOpenWaggleOrchestrationMock,
  extractJson: extractJsonMock,
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
    orchestrationMode: 'orchestrated',
    qualityPreset: 'medium',
    recentProjects: [],
    skillTogglesByProject: {},
    browserHeadless: true,
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

  it('returns fallback and closes ack run when planner call throws', async () => {
    chatMock.mockImplementation(() => createErrorStream(new Error('planner unavailable')))

    const emitChunk = vi.fn()
    const emitEvent = vi.fn()

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
      emitEvent,
      emitChunk,
    })

    expect(result).toEqual({
      status: 'fallback',
      runId: 'run-1',
      reason: 'planner unavailable',
    })
    // RUN_STARTED is emitted, plus fallback reason text is surfaced to the user.
    // No RUN_FINISHED — the classic fallback agent will emit its own.
    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(chunkTypes).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
    ])
  })

  it('emits TEXT_MESSAGE_END but not RUN_FINISHED when fallback after partial text', async () => {
    // Simulate planner returning tasks, then orchestration using fallback after ack text was streamed
    const planTasks = {
      ackText: 'Working on it.',
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
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
    })

    expect(result.status).toBe('fallback')
    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    // Message was started (ack text streamed), so TEXT_MESSAGE_END is emitted
    expect(chunkTypes).toContain('TEXT_MESSAGE_START')
    expect(chunkTypes).toContain('TEXT_MESSAGE_END')
    // But no RUN_FINISHED — classic fallback agent handles that
    expect(chunkTypes).not.toContain('RUN_FINISHED')
  })

  it('direct response path still emits RUN_FINISHED (regression guard)', async () => {
    chatMock.mockImplementation(() =>
      createStreamChunks('{"direct":true,"response":"Quick answer."}'),
    )
    extractJsonMock.mockReturnValue({ direct: true, response: 'Quick answer.' })

    const emitChunk = vi.fn()

    await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'What is 1+1?', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
    })

    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(chunkTypes).toContain('RUN_STARTED')
    expect(chunkTypes).toContain('TEXT_MESSAGE_START')
    expect(chunkTypes).toContain('TEXT_MESSAGE_END')
    expect(chunkTypes).toContain('RUN_FINISHED')
  })

  it('returns direct response when planner decides no orchestration needed', async () => {
    chatMock.mockImplementation(() =>
      createStreamChunks('{"direct":true,"response":"Here is the answer."}'),
    )
    extractJsonMock.mockReturnValue({ direct: true, response: 'Here is the answer.' })

    const emitChunk = vi.fn()
    const emitEvent = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'What is 2+2?',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent,
      emitChunk,
    })

    expect(result.status).toBe('completed')
    // Orchestration should NOT have been called
    expect(runOpenWaggleOrchestrationMock).not.toHaveBeenCalled()
    // Should have emitted text content chunks for the direct response
    const contentChunks = emitChunk.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT',
    )
    expect(contentChunks.length).toBeGreaterThan(0)
  })

  it('includes project context in planner prompt', async () => {
    chatMock.mockImplementation(() => createStreamChunks('{"direct":true,"response":"Got it."}'))
    extractJsonMock.mockReturnValue({ direct: true, response: 'Got it.' })

    await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Summarize this app',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk: vi.fn(),
    })

    expect(gatherProjectContextMock).toHaveBeenCalledWith('/tmp/project')
    // Verify the planner chat() call includes project context
    const chatCall = chatMock.mock.calls[0]
    const messages = chatCall[0].messages as Array<{ content: string }>
    const plannerPrompt = messages[0].content
    expect(plannerPrompt).toContain('## Project Context')
    expect(plannerPrompt).toContain('Project: test-app')
    expect(plannerPrompt).toContain('Summarize this app')
  })

  it('includes project context in executor prompt', async () => {
    const planTasks = {
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
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
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
    })

    // The executor chat() call is the second one (after the planner call)
    expect(chatMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    const executorCall = chatMock.mock.calls[1]
    const executorMessages = executorCall[0].messages as Array<{ content: string }>
    expect(executorMessages[0].content).toContain('## Project Context')
    expect(executorMessages[0].content).toContain('Project: test-app')
    expect(executorMessages[0].content).toContain('readFile')
    expect(executorMessages[0].content).toContain('webFetch')
  })

  it('runs orchestration when planner returns tasks', async () => {
    const planTasks = {
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
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
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
    })

    expect(result.status).toBe('completed')
    expect(runOpenWaggleOrchestrationMock).toHaveBeenCalledTimes(1)
    // Should have emitted ack text (LLM-generated or fallback)
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
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
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
    })

    expect(result).toEqual({
      status: 'cancelled',
      runId: 'run-1',
      newMessages: [],
    })
    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(chunkTypes).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
  })

  it('falls back to extractJson when direct JSON.parse fails (code fences)', async () => {
    const codeFencedResponse = '```json\n{"direct":true,"response":"Summary here."}\n```'
    chatMock.mockImplementation(() => createStreamChunks(codeFencedResponse))
    extractJsonMock.mockReturnValue({
      direct: true,
      response: 'Summary here.',
    })

    await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Summarize this app',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk: vi.fn(),
    })

    // extractJson is called as fallback when direct JSON.parse fails
    expect(extractJsonMock).toHaveBeenCalledTimes(1)
    const extractCallArg = extractJsonMock.mock.calls[0][0] as string
    expect(extractCallArg).toContain('"direct":true')
  })

  it('passes executor tools to createExecutorTools with project path', async () => {
    chatMock.mockImplementation(() => createStreamChunks('{"direct":true,"response":"OK"}'))
    extractJsonMock.mockReturnValue({ direct: true, response: 'OK' })

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
    })

    expect(createExecutorToolsMock).toHaveBeenCalledWith('/tmp/project', expect.any(Object))
  })

  it('forwards STEP_FINISHED chunks from planner to emitChunk', async () => {
    chatMock.mockImplementation(() =>
      createStreamChunksWithThinking(
        'Reasoning about the plan...',
        '{"direct":true,"response":"Answer."}',
      ),
    )

    const emitChunk = vi.fn()

    await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'What is TypeScript?', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
    })

    const stepChunks = emitChunk.mock.calls.filter((c) => {
      const t = (c[0] as { type: string }).type
      return t === 'STEP_STARTED' || t === 'STEP_FINISHED'
    })
    expect(stepChunks.length).toBe(2)
    expect((stepChunks[0][0] as { type: string }).type).toBe('STEP_STARTED')
    expect((stepChunks[1][0] as { type: string }).type).toBe('STEP_FINISHED')
  })

  it('forwards thinking chunks from executor to emitChunk', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    // First call (planner): plain text stream
    // Second call (executor): stream with thinking
    let callCount = 0
    chatMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return createStreamChunks(JSON.stringify(planTasks))
      }
      return createStreamChunksWithThinking('Reasoning about task...', 'Task result.')
    })
    extractJsonMock.mockReturnValue(planTasks)
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
    })

    // Executor thinking chunks should be forwarded via emitChunk
    const stepFinished = emitChunk.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'STEP_FINISHED',
    )
    expect(stepFinished.length).toBeGreaterThan(0)
  })

  it('modelText throws when planner stream contains RUN_ERROR', async () => {
    chatMock.mockImplementation(() =>
      createRunErrorStream('rate_limit_error', 'Rate limit exceeded'),
    )

    const emitChunk = vi.fn()
    const emitEvent = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Analyze code', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent,
      emitChunk,
    })

    // The error should bubble up and trigger fallback
    expect(result.status).toBe('fallback')
    expect(result.reason).toContain('rate_limit_error')
    expect(result.reason).toContain('Rate limit exceeded')
  })

  it('modelTextWithTools throws when executor stream contains RUN_ERROR', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    let callCount = 0
    chatMock.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return createStreamChunks(JSON.stringify(planTasks))
      }
      // Executor call returns RUN_ERROR
      return createRunErrorStream('server_error', 'Internal server error')
    })
    extractJsonMock.mockReturnValue(planTasks)
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
    })

    expect(chatMock).toHaveBeenCalledTimes(2)
    expect(executorError).toBeDefined()
    expect(executorError?.message).toContain('server_error')
    expect(executorError?.message).toContain('Internal server error')
  })

  it('returns cancelled when planner path is aborted before any message starts', async () => {
    chatMock.mockImplementation(() => createErrorStream(new Error('aborted')))

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
    })

    expect(result).toEqual({
      status: 'cancelled',
      runId: 'run-1',
      newMessages: [],
    })
    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(chunkTypes).toEqual(['RUN_STARTED', 'RUN_FINISHED'])
  })

  it('returns cancelled when executor path aborts after ack text is streamed', async () => {
    const planTasks = {
      ackText: 'Working on it.',
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    let callCount = 0
    chatMock.mockImplementation(() => {
      callCount += 1
      if (callCount === 1) {
        return createStreamChunks(JSON.stringify(planTasks))
      }
      return createErrorStream(new Error('aborted'))
    })
    extractJsonMock.mockReturnValue(planTasks)
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
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
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
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
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
    })

    expect(result.status).toBe('completed')
    const content = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
      .join('')
    expect(content).toContain('Let me inspect the repository structure first.')
  })

  it('synthesis falls back to concatenated outputs on empty result', async () => {
    const planTasks = {
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
    // Simulate runOpenWaggleOrchestration returning empty text (synthesis returned empty)
    // The orchestrator's empty-output guard should concatenate task outputs instead,
    // but from the service perspective we just verify it handles empty text gracefully
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
    })

    // Even with empty synthesis, the run should complete (not crash)
    expect(result.status).toBe('completed')
    // The separator should still be emitted
    const contentChunks = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
    expect(contentChunks.join('')).toContain('---')
  })

  it('falls back with visible message when planner JSON extraction fails', async () => {
    // Simulate planner returning garbage text that can't be parsed as JSON
    chatMock.mockImplementation(() => createStreamChunks('This is not JSON at all'))
    extractJsonMock.mockImplementation(() => {
      throw new Error('No JSON found in text')
    })

    const emitChunk = vi.fn()

    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: { text: 'Help me', qualityPreset: 'medium', attachments: [] },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent: vi.fn(),
      emitChunk,
    })

    // Should fall back (not silently proceed with empty tasks)
    expect(result.status).toBe('fallback')
    expect(result.reason).toContain('Planner output could not be parsed as JSON')
    // The fallback message should be streamed to the user
    const contentChunks = emitChunk.mock.calls
      .filter((c) => (c[0] as { type: string }).type === 'TEXT_MESSAGE_CONTENT')
      .map((c) => (c[0] as { delta: string }).delta)
    const fullText = contentChunks.join('')
    expect(fullText).toContain('Orchestration encountered an issue')
    expect(fullText).toContain('Falling back to direct execution')
  })

  it('includes task title in failure message', async () => {
    const planTasks = {
      tasks: [
        { id: 'task-1', kind: 'general', title: 'Analyze config', prompt: 'Read config files' },
      ],
    }
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
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
