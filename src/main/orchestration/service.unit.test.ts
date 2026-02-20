import { ConversationId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { Settings } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runOpenHiveOrchestrationMock, resolveProviderAndQualityMock } = vi.hoisted(() => ({
  runOpenHiveOrchestrationMock: vi.fn(),
  resolveProviderAndQualityMock: vi.fn(),
}))

vi.mock('@openhive/condukt-openhive', () => ({
  runOpenHiveOrchestration: runOpenHiveOrchestrationMock,
}))

vi.mock('../agent/shared', () => ({
  resolveProviderAndQuality: resolveProviderAndQualityMock,
  isResolutionError: (result: { ok: boolean }) => !result.ok,
  buildPersistedUserMessageParts: vi.fn(),
  buildSamplingOptions: vi.fn(),
  makeMessage: vi.fn(),
}))

import { runOrchestratedAgent } from './service'

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
  })

  it('returns fallback without emitting terminal chunks when orchestration throws', async () => {
    runOpenHiveOrchestrationMock.mockRejectedValue(new Error('planner unavailable'))

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
    expect(emitChunk).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
