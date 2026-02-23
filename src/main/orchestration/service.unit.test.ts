import { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import type { StreamChunk } from '@tanstack/ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  runOpenHiveOrchestrationMock,
  resolveProviderAndQualityMock,
  extractJsonMock,
  chatMock,
  gatherProjectContextMock,
  createExecutorToolsMock,
  maxIterationsMock,
} = vi.hoisted(() => ({
  runOpenHiveOrchestrationMock: vi.fn(),
  resolveProviderAndQualityMock: vi.fn(),
  extractJsonMock: vi.fn(),
  chatMock: vi.fn(),
  gatherProjectContextMock: vi.fn(),
  createExecutorToolsMock: vi.fn(),
  maxIterationsMock: vi.fn(),
}))

vi.mock('@openhive/condukt-openhive', () => ({
  runOpenHiveOrchestration: runOpenHiveOrchestrationMock,
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

import { hasWebIntent, runOrchestratedAgent } from './service'

// --- hasWebIntent unit tests ---

describe('hasWebIntent', () => {
  it('detects explicit URL', () => {
    expect(hasWebIntent('check https://tanstack.com/ai')).toBe(true)
  })

  it('detects "go to" keyword', () => {
    expect(hasWebIntent('go to tanstack ai docs')).toBe(true)
  })

  it('detects "docs" token', () => {
    expect(hasWebIntent('tanstack ai docs')).toBe(true)
  })

  it('detects "documentation" token', () => {
    expect(hasWebIntent('read the React documentation')).toBe(true)
  })

  it('detects "visit" keyword', () => {
    expect(hasWebIntent('visit the official site')).toBe(true)
  })

  it('detects "look up" keyword', () => {
    expect(hasWebIntent('look up the API reference')).toBe(true)
  })

  it('detects "website" token', () => {
    expect(hasWebIntent('what does the website say')).toBe(true)
  })

  it('returns false for pure knowledge question', () => {
    expect(hasWebIntent('what is TypeScript?')).toBe(false)
  })

  it('returns false for project-only question', () => {
    expect(hasWebIntent('explain how the agent loop works')).toBe(false)
  })

  it('does not false-positive on "documentary"', () => {
    expect(hasWebIntent('write a documentary-style summary')).toBe(false)
  })
})

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
    defaultModel: 'gpt-4.1-mini',
    projectPath: '/tmp/project',
    executionMode: 'full-access',
    orchestrationMode: 'orchestrated',
    qualityPreset: 'medium',
    recentProjects: [],
    skillTogglesByProject: {},
    browserHeadless: true,
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
    runOpenHiveOrchestrationMock.mockReset()
    resolveProviderAndQualityMock.mockReset()
    chatMock.mockReset()
    gatherProjectContextMock.mockReset()
    createExecutorToolsMock.mockReset()
    maxIterationsMock.mockReset()

    resolveProviderAndQualityMock.mockReturnValue({
      ok: true,
      provider: {
        id: 'openai',
        displayName: 'OpenAI',
        requiresApiKey: true,
        supportsBaseUrl: true,
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
        model: 'gpt-4.1-mini',
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

    createExecutorToolsMock.mockReturnValue([])
    maxIterationsMock.mockReturnValue(undefined)
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
      model: 'gpt-4.1-mini',
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
    // RUN_STARTED is emitted, but no message or RUN_FINISHED — the classic
    // fallback agent will emit its own RUN_STARTED → text → RUN_FINISHED.
    const chunkTypes = emitChunk.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(chunkTypes).toEqual(['RUN_STARTED'])
  })

  it('emits TEXT_MESSAGE_END but not RUN_FINISHED when fallback after partial text', async () => {
    // Simulate planner returning tasks, then orchestration using fallback after ack text was streamed
    const planTasks = {
      ackText: 'Working on it.',
      tasks: [{ id: 'task-1', kind: 'general', title: 'Task 1', prompt: 'Do thing 1' }],
    }
    chatMock.mockImplementation(() => createStreamChunks(JSON.stringify(planTasks)))
    extractJsonMock.mockReturnValue(planTasks)
    runOpenHiveOrchestrationMock.mockResolvedValue({
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
      model: 'gpt-4.1-mini',
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
      model: 'gpt-4.1-mini',
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
      model: 'gpt-4.1-mini',
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent,
      emitChunk,
    })

    expect(result.status).toBe('completed')
    // Orchestration should NOT have been called
    expect(runOpenHiveOrchestrationMock).not.toHaveBeenCalled()
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
      model: 'gpt-4.1-mini',
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
    runOpenHiveOrchestrationMock.mockImplementation(
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
      model: 'gpt-4.1-mini',
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
    runOpenHiveOrchestrationMock.mockResolvedValue({
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
      model: 'gpt-4.1-mini',
      settings: createSettings(),
      signal: new AbortController().signal,
      emitEvent,
      emitChunk,
    })

    expect(result.status).toBe('completed')
    expect(runOpenHiveOrchestrationMock).toHaveBeenCalledTimes(1)
    // Should have emitted ack text (LLM-generated or fallback)
    const ackContent = emitChunk.mock.calls.find((c) => {
      const chunk = c[0] as { type: string; delta?: string }
      return chunk.type === 'TEXT_MESSAGE_CONTENT' && chunk.delta && chunk.delta.length > 0
    })
    expect(ackContent).toBeTruthy()
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
      model: 'gpt-4.1-mini',
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
      model: 'gpt-4.1-mini',
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
      model: 'gpt-4.1-mini',
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
    runOpenHiveOrchestrationMock.mockImplementation(
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
      model: 'gpt-4.1-mini',
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
})
