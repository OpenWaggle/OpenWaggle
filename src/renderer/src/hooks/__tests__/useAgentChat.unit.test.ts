// @vitest-environment jsdom

import type { AgentSendPayload } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOptimisticUserMessageStore } from '../../stores/optimistic-user-message-store'
import { useAgentChat } from '../useAgentChat'

const {
  apiMock,
  hasActiveRunMock,
  useBackgroundRunStoreMock,
  upsertSessionMock,
  useChatStoreMock,
  agentEventHandlers,
  runCompletedHandlers,
} = vi.hoisted(() => ({
  apiMock: {
    onAgentEvent: vi.fn((handler: (payload: unknown) => void) => {
      agentEventHandlers.push(handler)
      return () => {}
    }),
    onRunCompleted: vi.fn((handler: (payload: unknown) => void) => {
      runCompletedHandlers.push(handler)
      return () => {}
    }),
    getBackgroundRun: vi.fn(async () => null),
    getSessionDetail: vi.fn(async () => null),
    sendMessage: vi.fn(async () => undefined),
    sendWaggleMessage: vi.fn(async () => undefined),
    cancelAgent: vi.fn(),
    steerAgent: vi.fn(async () => ({ preserved: true })),
  },
  hasActiveRunMock: vi.fn(() => false),
  useBackgroundRunStoreMock: vi.fn(
    (selector: (state: { hasActiveRun: (sessionId: string) => boolean }) => unknown) =>
      selector({ hasActiveRun: hasActiveRunMock }),
  ),
  upsertSessionMock: vi.fn(),
  useChatStoreMock: vi.fn(
    (selector: (state: { upsertSession: (value: unknown) => void }) => unknown) =>
      selector({ upsertSession: upsertSessionMock }),
  ),
  agentEventHandlers: [] as Array<(payload: unknown) => void>,
  runCompletedHandlers: [] as Array<(payload: unknown) => void>,
}))

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

vi.mock('@/stores/background-run-store', () => ({
  useBackgroundRunStore: useBackgroundRunStoreMock,
}))

vi.mock('@/stores/chat-store', () => ({
  useChatStore: useChatStoreMock,
}))

function emitAgentEvent(payload: unknown): void {
  for (const handler of agentEventHandlers) {
    handler(payload)
  }
}

function emitRunCompleted(payload: unknown): void {
  for (const handler of runCompletedHandlers) {
    handler(payload)
  }
}

function createSession(): SessionDetail {
  return {
    id: SessionId('session-1'),
    title: 'SessionDetail',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: MessageId('msg-1'),
        role: 'assistant',
        createdAt: 1,
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-1'),
              name: 'write',
              args: { path: 'file.txt' },
              state: 'input-complete',
            },
          },
        ],
      },
    ],
  }
}

function createSessionWithMessages(
  updatedAt: number,
  messages: SessionDetail['messages'],
): SessionDetail {
  return {
    id: SessionId('session-1'),
    title: 'SessionDetail',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt,
    messages,
  }
}

const SEND_PAYLOAD: AgentSendPayload = {
  text: 'Hello world',
  thinkingLevel: 'medium',
  attachments: [],
}

describe('useAgentChat', () => {
  afterEach(async () => {
    await act(async () => {
      cleanup()
      await Promise.resolve()
    })
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    apiMock.onAgentEvent.mockClear()
    apiMock.onRunCompleted.mockClear()
    apiMock.getBackgroundRun.mockReset()
    apiMock.getSessionDetail.mockReset()
    apiMock.sendMessage.mockReset()
    apiMock.sendWaggleMessage.mockReset()
    apiMock.cancelAgent.mockReset()
    apiMock.steerAgent.mockReset()
    hasActiveRunMock.mockReset()
    hasActiveRunMock.mockReturnValue(false)
    upsertSessionMock.mockReset()
    useChatStoreMock.mockClear()
    agentEventHandlers.length = 0
    runCompletedHandlers.length = 0
    useOptimisticUserMessageStore.setState({ messagesBySessionId: new Map() })
  })

  it('hydrates persisted tool-call state from the session snapshot', async () => {
    const session = createSession()

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        session,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      const part = result.current.messages[0]?.parts[0]
      expect(part).toEqual({
        type: 'tool-call',
        id: 'tool-1',
        name: 'write',
        arguments: '{"path":"file.txt"}',
        state: 'input-complete',
      })
    })
  })

  it('rehydrates the same session when a newer persisted snapshot arrives', async () => {
    const initialSession = createSessionWithMessages(1, [
      {
        id: MessageId('user-1'),
        role: 'user',
        createdAt: 1,
        parts: [{ type: 'text', text: 'transport smoke test' }],
      },
    ])

    const updatedSession = createSessionWithMessages(2, [
      {
        id: MessageId('user-1'),
        role: 'user',
        createdAt: 1,
        parts: [{ type: 'text', text: 'transport smoke test' }],
      },
      {
        id: MessageId('assistant-1'),
        role: 'assistant',
        createdAt: 2,
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-1'),
              name: 'read',
              args: { path: 'src/app.ts' },
              state: 'output-available',
            },
          },
          {
            type: 'tool-result',
            toolResult: {
              id: ToolCallId('tool-1'),
              result: { kind: 'text', text: 'file contents' },
              isError: false,
            },
          },
          {
            type: 'text',
            text: 'Transport looks healthy now.',
          },
        ],
      },
    ])

    const { result, rerender } = renderHook(
      ({ session }: { session: SessionDetail }) =>
        useAgentChat(
          SessionId('session-1'),
          session,
          SupportedModelId('claude-sonnet-4-5'),
          'medium',
        ),
      {
        initialProps: { session: initialSession },
      },
    )

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1)
      expect(result.current.messages[0]).toEqual(
        expect.objectContaining({
          role: 'user',
          parts: [{ type: 'text', content: 'transport smoke test' }],
        }),
      )
    })

    rerender({ session: updatedSession })

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2)
      expect(result.current.messages[1]).toEqual(
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'read',
              arguments: '{"path":"src/app.ts"}',
              state: 'output-available',
            },
            {
              type: 'tool-result',
              toolCallId: 'tool-1',
              content: { kind: 'text', text: 'file contents' },
              state: 'complete',
            },
            {
              type: 'text',
              content: 'Transport looks healthy now.',
            },
          ],
        }),
      )
    })
  })

  it('streams optimistic user and assistant text through OpenWaggle runtime events', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
    })

    expect(apiMock.sendMessage).toHaveBeenCalledWith(
      SessionId('session-1'),
      SEND_PAYLOAD,
      SupportedModelId('claude-sonnet-4-5'),
    )
    expect(result.current.messages.at(-1)?.role).toBe('user')

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'agent_start',
          runId: 'run-1',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_start',
          messageId: 'assistant-1',
          role: 'assistant',
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Working',
          },
          timestamp: 3,
        },
      })
      emitRunCompleted({ sessionId: SessionId('session-1') })
      await sendPromise
    })

    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Working' }],
      }),
    )
  })

  it('settles a foreground send when the run is cancelled', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
    })

    await act(async () => {
      result.current.stop()
      await sendPromise
    })

    expect(apiMock.cancelAgent).toHaveBeenCalledWith(SessionId('session-1'))
    expect(result.current.status).toBe('ready')
  })

  it('settles a foreground send when the run is steered', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
    })

    await act(async () => {
      await result.current.steer()
      await sendPromise
    })

    expect(apiMock.steerAgent).toHaveBeenCalledWith(SessionId('session-1'))
    expect(result.current.status).toBe('ready')
  })

  it('surfaces compaction lifecycle events as foreground activity', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'compaction_start',
          reason: 'manual',
          timestamp: 1,
        },
      })
    })

    expect(result.current.status).toBe('compacting')
    expect(result.current.isLoading).toBe(true)
    expect(result.current.compactionStatus).toEqual({ type: 'compacting', reason: 'manual' })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'compaction_end',
          reason: 'manual',
          result: {
            summary: 'Kept the active task context.',
            firstKeptEntryId: 'kept-user',
            tokensBefore: 123456,
          },
          aborted: false,
          willRetry: false,
          timestamp: 2,
        },
      })
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.isLoading).toBe(false)
    expect(result.current.compactionStatus).toBeNull()
  })

  it('applies stream text immediately as chunks arrive', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'agent_start',
          runId: 'run-1',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_start',
          messageId: 'assistant-1',
          role: 'assistant',
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Working',
          },
          timestamp: 3,
        },
      })
    })

    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', content: 'Working' }],
      }),
    )

    await act(async () => {
      emitRunCompleted({ sessionId: SessionId('session-1') })
      await sendPromise
    })
  })

  it('uses canonical tool input from toolcall_start without waiting for follow-up events', async () => {
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'agent_start',
          runId: 'run-1',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_start',
          messageId: 'assistant-1',
          role: 'assistant',
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'toolcall_start',
            contentIndex: 0,
            toolCallId: 'tool-2',
            toolName: 'read',
            input: { path: 'src/app.ts' },
          },
          timestamp: 3,
        },
      })
    })

    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-2',
            name: 'read',
            arguments: '{"path":"src/app.ts"}',
            state: 'input-complete',
          },
        ],
      }),
    )

    await act(async () => {
      emitRunCompleted({ sessionId: SessionId('session-1') })
      await sendPromise
    })
  })

  it('keeps an optimistic user message when reconnecting after a route remount', async () => {
    hasActiveRunMock.mockReturnValue(true)
    apiMock.getBackgroundRun.mockResolvedValue({
      sessionId: SessionId('session-1'),
      model: SupportedModelId('claude-sonnet-4-5'),
      mode: 'agent',
      startedAt: 1,
      parts: [],
    })
    useOptimisticUserMessageStore.getState().add(SessionId('session-1'), {
      id: 'optimistic-user-1',
      role: 'user',
      parts: [{ type: 'text', content: 'First prompt survives remount' }],
      createdAt: new Date(1),
    })

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, []),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.backgroundStreaming).toBe(true)
      expect(result.current.messages[0]).toEqual(
        expect.objectContaining({
          id: 'optimistic-user-1',
          role: 'user',
          parts: [{ type: 'text', content: 'First prompt survives remount' }],
        }),
      )
    })
  })

  it('continues streaming when agent_start arrives after a route remount', async () => {
    useOptimisticUserMessageStore.getState().add(SessionId('session-1'), {
      id: 'optimistic-user-1',
      role: 'user',
      parts: [{ type: 'text', content: 'First prompt survives remount' }],
      createdAt: new Date(1),
    })

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, []),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.messages[0]?.role).toBe('user')
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'agent_start',
          runId: 'run-1',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_start',
          messageId: 'assistant-1',
          role: 'assistant',
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Streaming after remount',
          },
          timestamp: 3,
        },
      })
    })

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'optimistic-user-1',
          role: 'user',
        }),
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', content: 'Streaming after remount' }],
        }),
      ]),
    )
  })

  it('uses the latest persisted session snapshot when reconnecting to a background run', async () => {
    hasActiveRunMock.mockReturnValue(true)
    apiMock.getBackgroundRun.mockResolvedValue(null)
    apiMock.getSessionDetail.mockResolvedValue(
      createSessionWithMessages(2, [
        {
          id: MessageId('user-1'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Persisted prompt' }],
        },
      ]),
    )

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, []),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.messages[0]).toEqual(
        expect.objectContaining({
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', content: 'Persisted prompt' }],
        }),
      )
    })
  })

  it('reconnects to an active background run snapshot', async () => {
    hasActiveRunMock.mockReturnValue(true)
    apiMock.getBackgroundRun.mockResolvedValue({
      sessionId: SessionId('session-1'),
      model: SupportedModelId('claude-sonnet-4-5'),
      mode: 'agent',
      startedAt: 1,
      parts: [{ type: 'text', text: 'Partial answer' }],
    })

    const session = createSession()
    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        session,
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.backgroundStreaming).toBe(true)
      expect(result.current.messages.at(-1)).toEqual(
        expect.objectContaining({
          role: 'assistant',
          parts: [{ type: 'text', content: 'Partial answer' }],
        }),
      )
    })
  })
})
