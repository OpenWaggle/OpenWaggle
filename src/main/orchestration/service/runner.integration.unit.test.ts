import type { AgentSendPayload, MessagePart } from '@shared/types/agent'
import { ConversationId, MessageId, SupportedModelId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import { maxIterations, type StreamChunk } from '@tanstack/ai'
import { createOpenaiChat } from '@tanstack/ai-openai'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRunStore, runOpenWaggleOrchestration } from '../engine'
import { createOrchestratedAgentRunner } from './runner'
import type { OrchestrationServiceDeps } from './types'

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

async function* createTextStream(text: string): AsyncGenerator<StreamChunk> {
  yield {
    type: 'TEXT_MESSAGE_CONTENT',
    timestamp: Date.now(),
    messageId: 'msg-1',
    delta: text,
  } satisfies StreamChunk
  yield {
    type: 'RUN_FINISHED',
    timestamp: Date.now(),
    runId: 'run-1',
    finishReason: 'stop',
  } satisfies StreamChunk
}

function buildPersistedUserParts(payload: AgentSendPayload): MessagePart[] {
  const parts: MessagePart[] = []
  if (payload.text.trim()) {
    parts.push({ type: 'text', text: payload.text.trim() })
  }
  for (const attachment of payload.attachments) {
    const persisted = {
      id: attachment.id,
      kind: attachment.kind,
      name: attachment.name,
      path: attachment.path,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      extractedText: attachment.extractedText,
    }
    parts.push({ type: 'attachment', attachment: persisted })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

function readChunkType(chunk: unknown): string | null {
  if (!chunk || typeof chunk !== 'object' || !('type' in chunk)) return null
  const typeValue = chunk.type
  return typeof typeValue === 'string' ? typeValue : null
}

function createIntegrationDeps(responses: readonly string[]): {
  deps: OrchestrationServiceDeps
  chatCalls: ReturnType<typeof vi.fn>
} {
  let responseIndex = 0
  let now = 1
  let messageSeq = 0
  const chatCalls = vi.fn()

  const chat: OrchestrationServiceDeps['chat'] = (input) => {
    chatCalls(input)
    const text = responses[responseIndex] ?? ''
    responseIndex += 1
    return createTextStream(text)
  }

  const deps: OrchestrationServiceDeps = {
    now: () => {
      now += 1
      return now
    },
    sleep: async () => {},
    randomId: () => {
      messageSeq += 1
      return `msg-${String(messageSeq)}`
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    streamChunkSize: 50,
    streamChunkDelayMs: 0,
    loadProjectConfig: async () => ({}),
    resolveProviderAndQuality: async (
      model: SupportedModelId,
      _qualityPreset,
      providers,
      _projectOverrides,
    ) => {
      const providerConfig = providers.openai
      if (!providerConfig) {
        return {
          ok: false,
          reason: 'missing provider config',
        }
      }
      return {
        ok: true,
        provider: {
          id: 'openai',
          displayName: 'OpenAI',
          requiresApiKey: true,
          supportsBaseUrl: true,
          supportsSubscription: true,
          supportsDynamicModelFetch: false,
          models: [model],
          testModel: model,
          createAdapter(_targetModel, apiKey) {
            return createOpenaiChat('gpt-4.1-mini', apiKey)
          },
        },
        providerConfig,
        resolvedModel: model,
        qualityConfig: {
          model,
          maxTokens: 2000,
          temperature: 0.2,
          topP: 0.9,
        },
      }
    },
    isResolutionError: (result) => !result.ok,
    isReasoningModel: () => false,
    buildPersistedUserMessageParts: buildPersistedUserParts,
    buildSamplingOptions: (qualityConfig) => {
      const options: { temperature?: number; topP?: number } = {}
      if (qualityConfig.temperature !== undefined) options.temperature = qualityConfig.temperature
      if (qualityConfig.topP !== undefined) options.topP = qualityConfig.topP
      return options
    },
    makeMessage: (role, parts, model, metadata) => ({
      id: MessageId(`message-${String(messageSeq + 1)}`),
      role,
      parts,
      model,
      metadata,
      createdAt: now,
    }),
    gatherProjectContext: async () => ({
      text: '',
      rawLength: 0,
      durationMs: 0,
    }),
    createExecutorTools: () => [],
    runOpenWaggleOrchestration,
    extractJson: (text) => {
      const open = text.indexOf('{')
      const close = text.lastIndexOf('}')
      if (open === -1 || close === -1 || close < open) {
        throw new Error('No JSON found in text')
      }
      return JSON.parse(text.slice(open, close + 1))
    },
    chat,
    maxIterations,
    runRepository: {
      createRunStore: () => new MemoryRunStore(),
    },
  }

  return { deps, chatCalls }
}

describe('createOrchestratedAgentRunner integration', () => {
  it('returns direct planner response without invoking orchestration engine', async () => {
    const plannerResponse = JSON.stringify({
      direct: true,
      response: 'Direct answer',
    })
    const { deps, chatCalls } = createIntegrationDeps([plannerResponse])
    const runOrchestratedAgent = createOrchestratedAgentRunner(deps)

    const chunks: unknown[] = []
    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'What is TypeScript?',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitChunk: (chunk) => chunks.push(chunk),
      emitEvent: () => {},
    })

    expect(result.status).toBe('completed')
    const assistantMessage = result.newMessages?.[1]
    const assistantTextPart = assistantMessage?.parts.find((part) => part.type === 'text')
    if (!assistantTextPart || assistantTextPart.type !== 'text') {
      throw new Error('expected assistant text part')
    }
    expect(assistantTextPart.text).toContain('Direct answer')
    expect(chatCalls).toHaveBeenCalledTimes(1)

    const chunkTypes = chunks.map(readChunkType).filter((type): type is string => type !== null)
    expect(chunkTypes).toContain('RUN_STARTED')
    expect(chunkTypes).toContain('RUN_FINISHED')
  })

  it('runs planner, executor, and synthesizer through the real orchestration engine', async () => {
    const plannerResponse = JSON.stringify({
      ackText: 'Working through the task list.',
      tasks: [
        {
          id: 'task-1',
          kind: 'general',
          title: 'Inspect project',
          prompt: 'Read key files',
        },
      ],
    })
    const executorResponse = 'Executor output'
    const synthesisResponse = 'Final synthesized answer'
    const { deps, chatCalls } = createIntegrationDeps([
      plannerResponse,
      executorResponse,
      synthesisResponse,
    ])
    const runOrchestratedAgent = createOrchestratedAgentRunner(deps)

    const chunks: unknown[] = []
    const events: unknown[] = []
    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Analyze this project',
        qualityPreset: 'medium',
        attachments: [],
      } satisfies AgentSendPayload,
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitChunk: (chunk) => chunks.push(chunk),
      emitEvent: (event) => events.push(event),
    })

    expect(result.status).toBe('completed')
    expect(result.newMessages).toHaveLength(2)
    const assistantMessage = result.newMessages?.[1]
    const assistantTextPart = assistantMessage?.parts.find((part) => part.type === 'text')
    if (!assistantTextPart || assistantTextPart.type !== 'text') {
      throw new Error('expected assistant text part')
    }
    expect(assistantTextPart.text).toContain('Working through the task list')
    expect(assistantTextPart.text).toContain('Final synthesized answer')
    expect(chatCalls).toHaveBeenCalledTimes(3)

    const chunkTypes = chunks.map(readChunkType).filter((type): type is string => type !== null)
    expect(chunkTypes[0]).toBe('RUN_STARTED')
    expect(chunkTypes).toContain('RUN_FINISHED')
    expect(events.length).toBeGreaterThan(0)
  })

  it('keeps fallback handoff semantics when planner JSON cannot be parsed', async () => {
    const { deps } = createIntegrationDeps(['not-json'])
    const runOrchestratedAgent = createOrchestratedAgentRunner(deps)

    const chunks: unknown[] = []
    const result = await runOrchestratedAgent({
      runId: 'run-1',
      conversationId: ConversationId('conversation-1'),
      conversation: createConversation(),
      payload: {
        text: 'Analyze this project',
        qualityPreset: 'medium',
        attachments: [],
      },
      model: SupportedModelId('gpt-4.1-mini'),
      settings: createSettings(),
      signal: new AbortController().signal,
      emitChunk: (chunk) => chunks.push(chunk),
      emitEvent: () => {},
    })

    expect(result.status).toBe('fallback')
    const chunkTypes = chunks.map(readChunkType).filter((type): type is string => type !== null)
    expect(chunkTypes).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
    ])
    expect(chunkTypes).not.toContain('RUN_FINISHED')
  })
})
