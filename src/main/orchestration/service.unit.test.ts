import { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
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

import { runOrchestratedAgent } from './service'

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
    chatMock.mockRejectedValue(new Error('planner unavailable'))

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
    chatMock.mockResolvedValue(JSON.stringify(planTasks))
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
    chatMock.mockResolvedValue('{"direct":true,"response":"Quick answer."}')
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
    chatMock.mockResolvedValue('{"direct":true,"response":"Here is the answer."}')
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
    chatMock.mockResolvedValue('{"direct":true,"response":"Got it."}')
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
    chatMock.mockResolvedValue(JSON.stringify(planTasks))
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
    chatMock.mockResolvedValue(JSON.stringify(planTasks))
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
    chatMock.mockResolvedValue(codeFencedResponse)
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
    chatMock.mockResolvedValue('{"direct":true,"response":"OK"}')
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

    expect(createExecutorToolsMock).toHaveBeenCalledWith('/tmp/project')
  })
})
