import type { Message, MessagePart } from '@shared/types/agent'
import { ConversationId, MessageId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { WaggleConfig, WaggleTurnEvent } from '@shared/types/waggle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runAgentMock, checkConsensusMock, makeMessageMock } = vi.hoisted(() => ({
  runAgentMock: vi.fn(),
  checkConsensusMock: vi.fn(),
  makeMessageMock: vi.fn(),
}))

vi.mock('../agent-loop', () => ({
  runAgent: runAgentMock,
}))

vi.mock('../consensus-detector', () => ({
  checkConsensus: checkConsensusMock,
}))

vi.mock('../shared', () => ({
  makeMessage: makeMessageMock,
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { runWaggleSequential } from '../waggle-coordinator'

const AGENT_A_MODEL = SupportedModelId('claude-sonnet-4-5')
const AGENT_B_MODEL = SupportedModelId('gpt-4.1-mini')

function createConversation(): Conversation {
  return {
    id: ConversationId('conv-1'),
    title: 'Waggle thread',
    projectPath: '/repo',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

function createConfig(overrides?: Partial<WaggleConfig['stop']>): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Researcher',
        model: AGENT_A_MODEL,
        roleDescription: 'Investigates the current code',
        color: 'blue',
      },
      {
        label: 'Implementer',
        model: AGENT_B_MODEL,
        roleDescription: 'Plans the fix',
        color: 'amber',
      },
    ],
    stop: {
      primary: 'consensus',
      maxTurnsSafety: 4,
      ...overrides,
    },
  }
}

function createMessage(
  role: Message['role'],
  parts: readonly MessagePart[],
  model?: string,
  metadata?: Message['metadata'],
): Message {
  return {
    id: MessageId(`${role}-${Math.random().toString(16).slice(2)}`),
    role,
    parts,
    ...(model ? { model: SupportedModelId(model) } : {}),
    ...(metadata ? { metadata } : {}),
    createdAt: Date.now(),
  }
}

function createAssistantMessage(
  text: string,
  model: string,
  metadata?: Message['metadata'],
): Message {
  return createMessage('assistant', [{ type: 'text', text }], model, metadata)
}

describe('runWaggleSequential', () => {
  beforeEach(() => {
    runAgentMock.mockReset()
    checkConsensusMock.mockReset()
    makeMessageMock.mockReset()

    checkConsensusMock.mockReturnValue({
      reached: false,
      confidence: 0.1,
      reason: 'keep going',
      signals: [],
    })
    makeMessageMock.mockImplementation(
      (
        role: Message['role'],
        parts: readonly MessagePart[],
        model?: string,
        metadata?: Message['metadata'],
      ): Message => createMessage(role, parts, model, metadata),
    )
  })

  it('stops after two consecutive failed turns and preserves the last error', async () => {
    runAgentMock.mockImplementation(
      async ({
        onChunk,
      }: {
        onChunk: (chunk: { type: 'RUN_ERROR'; error: { message: string } }) => void
      }) => {
        onChunk({
          type: 'RUN_ERROR',
          error: { message: 'Model credits exhausted' },
        })
        return {
          newMessages: [],
          finalMessage: createMessage('assistant', []),
        }
      },
    )

    const events: WaggleTurnEvent[] = []
    const result = await runWaggleSequential({
      conversationId: ConversationId('conv-1'),
      conversation: createConversation(),
      payload: {
        text: 'Review the architecture hotspots',
        qualityPreset: 'medium',
        attachments: [],
      },
      config: createConfig(),
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      onStreamChunk: vi.fn(),
      onTurnEvent: (event) => {
        events.push(event)
      },
    })

    expect(runAgentMock).toHaveBeenCalledTimes(2)
    expect(result.status).toBe('stopped')
    expect(result.totalTurns).toBe(0)
    expect(result.lastError).toBe('Model credits exhausted')
    expect(events).toContainEqual({
      type: 'collaboration-stopped',
      reason: 'Model credits exhausted',
    })
  })

  it('runs a synthesis pass after two successful turns', async () => {
    runAgentMock
      .mockResolvedValueOnce({
        newMessages: [createMessage('user', [{ type: 'text', text: 'turn 1 context' }])],
        finalMessage: createAssistantMessage('Agent A proposes a plan.', AGENT_A_MODEL),
      })
      .mockResolvedValueOnce({
        newMessages: [createMessage('user', [{ type: 'text', text: 'turn 2 context' }])],
        finalMessage: createAssistantMessage('Agent B refines the plan.', AGENT_B_MODEL),
      })
      .mockResolvedValueOnce({
        newMessages: [],
        finalMessage: createAssistantMessage('Synthesis summary.', AGENT_A_MODEL),
      })

    const events: WaggleTurnEvent[] = []
    const result = await runWaggleSequential({
      conversationId: ConversationId('conv-1'),
      conversation: createConversation(),
      payload: {
        text: 'Produce a concise remediation plan',
        qualityPreset: 'medium',
        attachments: [],
      },
      config: createConfig({ primary: 'user-stop', maxTurnsSafety: 2 }),
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      onStreamChunk: vi.fn(),
      onTurnEvent: (event) => {
        events.push(event)
      },
    })

    expect(runAgentMock).toHaveBeenCalledTimes(3)
    expect(events).toContainEqual({ type: 'synthesis-start' })
    expect(result.status).toBe('completed')
    // totalTurns counts only debate turns (from successfulTurnCount), not synthesis
    expect(result.totalTurns).toBe(2)
    expect(result.newMessages).toHaveLength(4)

    // Synthesis message has no waggle metadata — renders as plain assistant message
    const synthesisMessage = result.newMessages.at(-1)
    expect(synthesisMessage?.metadata?.waggle).toBeUndefined()
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'turn-end',
        agentLabel: 'Synthesis',
        agentIndex: -1,
      }),
    )
  })

  it('retries synthesis with Agent A model when default model synthesis fails', async () => {
    const settingsWithFallback = {
      ...DEFAULT_SETTINGS,
      defaultModel: SupportedModelId('gpt-5.4'),
    }

    runAgentMock
      .mockResolvedValueOnce({
        newMessages: [createMessage('user', [{ type: 'text', text: 'turn 1 context' }])],
        finalMessage: createAssistantMessage('Agent A proposes a plan.', AGENT_A_MODEL),
      })
      .mockResolvedValueOnce({
        newMessages: [createMessage('user', [{ type: 'text', text: 'turn 2 context' }])],
        finalMessage: createAssistantMessage('Agent B refines the plan.', AGENT_B_MODEL),
      })
      .mockRejectedValueOnce(new Error('Default synthesis model unavailable'))
      .mockResolvedValueOnce({
        newMessages: [],
        finalMessage: createAssistantMessage('Recovered synthesis summary.', AGENT_A_MODEL),
      })

    const result = await runWaggleSequential({
      conversationId: ConversationId('conv-1'),
      conversation: createConversation(),
      payload: {
        text: 'Produce a concise remediation plan',
        qualityPreset: 'medium',
        attachments: [],
      },
      config: createConfig({ primary: 'user-stop', maxTurnsSafety: 2 }),
      settings: settingsWithFallback,
      signal: new AbortController().signal,
      onStreamChunk: vi.fn(),
      onTurnEvent: vi.fn(),
    })

    expect(runAgentMock).toHaveBeenCalledTimes(4)
    expect(runAgentMock.mock.calls[2]?.[0]?.model).toBe(SupportedModelId('gpt-5.4'))
    expect(runAgentMock.mock.calls[3]?.[0]?.model).toBe(AGENT_A_MODEL)
    expect(result.status).toBe('completed')
    expect(result.newMessages).toHaveLength(4)
    expect(result.lastError).toBeUndefined()
  })

  it('propagates synthesis failure reason when all synthesis model attempts fail', async () => {
    const settingsWithFallback = {
      ...DEFAULT_SETTINGS,
      defaultModel: SupportedModelId('gpt-5.4'),
    }

    runAgentMock
      .mockResolvedValueOnce({
        newMessages: [createMessage('user', [{ type: 'text', text: 'turn 1 context' }])],
        finalMessage: createAssistantMessage('Agent A proposes a plan.', AGENT_A_MODEL),
      })
      .mockResolvedValueOnce({
        newMessages: [createMessage('user', [{ type: 'text', text: 'turn 2 context' }])],
        finalMessage: createAssistantMessage('Agent B refines the plan.', AGENT_B_MODEL),
      })
      .mockRejectedValueOnce(new Error('Default synthesis model unavailable'))
      .mockRejectedValueOnce(new Error('Fallback synthesis model unavailable'))

    const result = await runWaggleSequential({
      conversationId: ConversationId('conv-1'),
      conversation: createConversation(),
      payload: {
        text: 'Produce a concise remediation plan',
        qualityPreset: 'medium',
        attachments: [],
      },
      config: createConfig({ primary: 'user-stop', maxTurnsSafety: 2 }),
      settings: settingsWithFallback,
      signal: new AbortController().signal,
      onStreamChunk: vi.fn(),
      onTurnEvent: vi.fn(),
    })

    expect(runAgentMock).toHaveBeenCalledTimes(4)
    expect(result.status).toBe('completed')
    expect(result.newMessages).toHaveLength(3)
    expect(result.lastError).toContain('Fallback synthesis model unavailable')
  })

  it('injects the synthesis guideline into waggle turn prompts', async () => {
    runAgentMock.mockImplementationOnce(async ({ payload }: { payload: { text: string } }) => {
      expect(payload.text).toContain(
        '- End your turn with a concise, direct summary of your findings and position. Write naturally — do not label it with "Synthesis:", "Summary:", or similar prefixes.',
      )

      return {
        newMessages: [createMessage('user', [{ type: 'text', text: 'turn 1 context' }])],
        finalMessage: createAssistantMessage(
          'Here is the verified implementation status.',
          AGENT_A_MODEL,
        ),
      }
    })

    const result = await runWaggleSequential({
      conversationId: ConversationId('conv-1'),
      conversation: createConversation(),
      payload: {
        text: 'Inspect the current prompt wiring',
        qualityPreset: 'medium',
        attachments: [],
      },
      config: createConfig({ primary: 'user-stop', maxTurnsSafety: 1 }),
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      onStreamChunk: vi.fn(),
      onTurnEvent: vi.fn(),
    })

    expect(result.status).toBe('completed')
    expect(result.totalTurns).toBe(1)
  })

  it('stops collaboration when a turn finishes with unresolved tool calls', async () => {
    runAgentMock.mockResolvedValueOnce({
      newMessages: [createMessage('user', [{ type: 'text', text: 'turn 1 context' }])],
      finalMessage: createMessage(
        'assistant',
        [
          { type: 'text', text: 'I need to inspect one more thing first.' },
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-approval'),
              name: 'runCommand',
              args: { command: 'pwd' },
              state: 'approval-requested',
              approval: {
                id: 'approval_tool-approval',
                needsApproval: true,
              },
            },
          },
        ],
        AGENT_A_MODEL,
      ),
    })

    const events: WaggleTurnEvent[] = []
    const result = await runWaggleSequential({
      conversationId: ConversationId('conv-1'),
      conversation: createConversation(),
      payload: {
        text: 'Inspect the repository and summarize findings',
        qualityPreset: 'medium',
        attachments: [],
      },
      config: createConfig(),
      settings: DEFAULT_SETTINGS,
      signal: new AbortController().signal,
      onStreamChunk: vi.fn(),
      onTurnEvent: (event) => {
        events.push(event)
      },
    })

    expect(runAgentMock).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('stopped')
    expect(result.lastError).toContain('unresolved tool calls')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'collaboration-stopped',
      }),
    )
  })
})
