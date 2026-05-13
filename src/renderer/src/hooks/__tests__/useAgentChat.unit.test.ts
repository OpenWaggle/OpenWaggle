// @vitest-environment jsdom

import type { AgentSendPayload } from '@shared/types/agent'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOptimisticUserMessageStore } from '../../stores/optimistic-user-message-store'
import { useAgentChat } from '../useAgentChat'
import { getUIMessageText } from '../useAgentChat.utils'

const {
  apiMock,
  getRunRenderSnapshotMock,
  hasActiveRunMock,
  runRenderSnapshots,
  setRunRenderMessagesMock,
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
    cancelAgent: vi.fn(async () => undefined),
    steerAgent: vi.fn(async () => ({ preserved: true })),
  },
  runRenderSnapshots: new Map<
    string,
    { readonly messages: readonly unknown[]; updatedAt: number }
  >(),
  getRunRenderSnapshotMock: vi.fn(
    (sessionId: string) => runRenderSnapshots.get(String(sessionId)) ?? null,
  ),
  setRunRenderMessagesMock: vi.fn((sessionId: string, messages: readonly unknown[]) => {
    runRenderSnapshots.set(String(sessionId), {
      messages: [...messages],
      updatedAt: Date.now(),
    })
  }),
  hasActiveRunMock: vi.fn(() => false),
  useBackgroundRunStoreMock: vi.fn(
    (
      selector: (state: {
        getRunRenderSnapshot: (sessionId: string) => unknown
        hasActiveRun: (sessionId: string) => boolean
        setRunRenderMessages: (sessionId: string, messages: readonly unknown[]) => void
      }) => unknown,
    ) =>
      selector({
        getRunRenderSnapshot: getRunRenderSnapshotMock,
        hasActiveRun: hasActiveRunMock,
        setRunRenderMessages: setRunRenderMessagesMock,
      }),
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

function createSessionWithId(id: SessionId): SessionDetail {
  return {
    id,
    title: `Session ${String(id)}`,
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }
}

function createSessionWithIdAndMessages(
  id: SessionId,
  updatedAt: number,
  messages: SessionDetail['messages'],
): SessionDetail {
  return {
    id,
    title: `Session ${String(id)}`,
    projectPath: `/tmp/${String(id)}`,
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

function createDeferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} {
  let resolveValue = (_value: T) => {}
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })

  return { promise, resolve: resolveValue }
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
    apiMock.cancelAgent.mockResolvedValue(undefined)
    apiMock.steerAgent.mockReset()
    getRunRenderSnapshotMock.mockClear()
    hasActiveRunMock.mockReset()
    hasActiveRunMock.mockReturnValue(false)
    runRenderSnapshots.clear()
    setRunRenderMessagesMock.mockClear()
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

  it('surfaces send failures and clears the foreground run loading state', async () => {
    const failure = new Error('Invalid arguments for "agent:send-message"')
    apiMock.sendMessage.mockRejectedValueOnce(failure)

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSession(),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await act(async () => {
      await expect(result.current.sendMessage(SEND_PAYLOAD)).rejects.toThrow(
        'Invalid arguments for "agent:send-message"',
      )
    })

    expect(result.current.error).toBe(failure)
    expect(result.current.status).toBe('error')
    expect(result.current.isLoading).toBe(false)
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

  it('does not fail a foreground send when the selected session changes mid-run', async () => {
    const send = createDeferred<void>()
    apiMock.sendMessage.mockReturnValueOnce(send.promise)

    const { result, rerender } = renderHook(
      ({
        sessionId,
        session,
      }: {
        readonly sessionId: SessionId
        readonly session: SessionDetail
      }) => useAgentChat(sessionId, session, SupportedModelId('claude-sonnet-4-5'), 'medium'),
      {
        initialProps: {
          sessionId: SessionId('session-1'),
          session: createSessionWithId(SessionId('session-1')),
        },
      },
    )

    let sendPromise: Promise<void> | null = null
    await act(async () => {
      sendPromise = result.current.sendMessage(SEND_PAYLOAD)
      await Promise.resolve()
    })

    expect(result.current.status).toBe('submitted')

    await act(async () => {
      rerender({
        sessionId: SessionId('session-2'),
        session: createSessionWithId(SessionId('session-2')),
      })
      await Promise.resolve()
    })

    await act(async () => {
      send.resolve(undefined)
      await expect(sendPromise).resolves.toBeUndefined()
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.error).toBeUndefined()
  })

  it('ignores events from a stale session subscription after the selected session changes', async () => {
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')

    const { result, rerender } = renderHook(
      ({
        sessionId,
        session,
      }: {
        readonly sessionId: SessionId
        readonly session: SessionDetail
      }) => useAgentChat(sessionId, session, SupportedModelId('claude-sonnet-4-5'), 'medium'),
      {
        initialProps: {
          sessionId: sessionA,
          session: createSessionWithId(sessionA),
        },
      },
    )

    await act(async () => {
      rerender({
        sessionId: sessionB,
        session: createSessionWithId(sessionB),
      })
      await Promise.resolve()
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'agent_start',
          runId: 'stale-run-a',
          timestamp: 1,
        },
      })
    })

    expect(result.current.status).toBe('ready')
    expect(result.current.backgroundStreaming).toBe(false)
    expect(result.current.messages).toEqual([])
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

  it('hydrates active run rendering from the renderer cache before reconnect completes', async () => {
    hasActiveRunMock.mockReturnValue(true)
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)
    runRenderSnapshots.set('session-1', {
      updatedAt: 1,
      messages: [
        {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', content: 'Keep live output visible' }],
          createdAt: new Date(1),
        },
        {
          id: 'assistant-1',
          role: 'assistant',
          parts: [
            { type: 'thinking', content: 'Cached reasoning is already visible' },
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'read',
              arguments: '{"path":"package.json"}',
              state: 'input-complete',
            },
          ],
          createdAt: new Date(2),
        },
      ],
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
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'assistant-1',
            role: 'assistant',
            parts: [
              { type: 'thinking', content: 'Cached reasoning is already visible' },
              {
                type: 'tool-call',
                id: 'tool-1',
                name: 'read',
                arguments: '{"path":"package.json"}',
                state: 'input-complete',
              },
            ],
          }),
        ]),
      )
    })
  })

  it('keeps active run render caches isolated across sessions with the same starter prompt', async () => {
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')
    const prompt = 'Draft a one-page summary of this app'
    hasActiveRunMock.mockReturnValue(true)
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)
    runRenderSnapshots.set('session-a', {
      updatedAt: 1,
      messages: [
        {
          id: 'optimistic-a',
          role: 'user',
          parts: [{ type: 'text', content: prompt }],
          createdAt: new Date(1),
        },
        {
          id: 'assistant-a',
          role: 'assistant',
          parts: [{ type: 'thinking', content: 'Reasoning for project A' }],
          createdAt: new Date(2),
        },
      ],
    })
    runRenderSnapshots.set('session-b', {
      updatedAt: 1,
      messages: [
        {
          id: 'optimistic-b',
          role: 'user',
          parts: [{ type: 'text', content: prompt }],
          createdAt: new Date(1),
        },
        {
          id: 'assistant-b',
          role: 'assistant',
          parts: [{ type: 'thinking', content: 'Reasoning for project B' }],
          createdAt: new Date(2),
        },
      ],
    })

    const createPersistedSession = (id: SessionId) =>
      createSessionWithIdAndMessages(id, 1, [
        {
          id: MessageId(`persisted-${String(id)}`),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: prompt }],
        },
      ])

    const { result, rerender } = renderHook(
      ({
        sessionId,
        session,
      }: {
        readonly sessionId: SessionId
        readonly session: SessionDetail
      }) => useAgentChat(sessionId, session, SupportedModelId('claude-sonnet-4-5'), 'medium'),
      {
        initialProps: {
          sessionId: sessionA,
          session: createPersistedSession(sessionA),
        },
      },
    )

    await waitFor(() => {
      expect(
        result.current.messages.filter((message) => getUIMessageText(message) === prompt),
      ).toHaveLength(1)
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'assistant-a',
            parts: [{ type: 'thinking', content: 'Reasoning for project A' }],
          }),
        ]),
      )
    })

    rerender({
      sessionId: sessionB,
      session: createPersistedSession(sessionB),
    })

    await waitFor(() => {
      expect(
        result.current.messages.filter((message) => getUIMessageText(message) === prompt),
      ).toHaveLength(1)
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'assistant-b',
            parts: [{ type: 'thinking', content: 'Reasoning for project B' }],
          }),
        ]),
      )
      expect(result.current.messages).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'assistant-a' })]),
      )
    })

    rerender({
      sessionId: sessionA,
      session: createPersistedSession(sessionA),
    })

    await waitFor(() => {
      expect(
        result.current.messages.filter((message) => getUIMessageText(message) === prompt),
      ).toHaveLength(1)
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'assistant-a',
            parts: [{ type: 'thinking', content: 'Reasoning for project A' }],
          }),
        ]),
      )
      expect(result.current.messages).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'assistant-b' })]),
      )
    })
  })

  it('does not wipe an active run render snapshot with stale render output during a switch', async () => {
    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    hasActiveRunMock.mockImplementation((id: SessionId) => id === sessionB)
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)
    runRenderSnapshots.set('session-b', {
      updatedAt: 1,
      messages: [
        {
          id: 'user-b',
          role: 'user',
          parts: [{ type: 'text', content: 'Session B prompt' }],
          createdAt: new Date(1),
        },
        {
          id: 'assistant-b',
          role: 'assistant',
          parts: [{ type: 'thinking', content: 'Session B cached answer' }],
          createdAt: new Date(2),
        },
      ],
    })

    const { result, rerender } = renderHook(
      ({
        sessionId,
        session,
      }: {
        readonly sessionId: SessionId
        readonly session: SessionDetail
      }) => useAgentChat(sessionId, session, SupportedModelId('claude-sonnet-4-5'), 'medium'),
      {
        initialProps: {
          sessionId: sessionA,
          session: createSessionWithIdAndMessages(sessionA, 1, [
            {
              id: MessageId('assistant-a'),
              role: 'assistant',
              createdAt: 1,
              parts: [{ type: 'text', text: 'Session A persisted answer' }],
            },
          ]),
        },
      },
    )

    await waitFor(() => {
      expect(result.current.messages.map(getUIMessageText)).toEqual(['Session A persisted answer'])
    })

    setRunRenderMessagesMock.mockClear()

    await act(async () => {
      rerender({
        sessionId: sessionB,
        session: createSessionWithIdAndMessages(sessionB, 1, []),
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(JSON.stringify(result.current.messages)).toContain('Session B cached answer')
    })

    const sessionBSnapshotWrites = setRunRenderMessagesMock.mock.calls.filter(
      ([id]) => id === sessionB,
    )
    expect(sessionBSnapshotWrites.length).toBeGreaterThan(0)
    for (const [, writtenMessages] of sessionBSnapshotWrites) {
      expect(writtenMessages).not.toHaveLength(0)
      const serializedMessages = JSON.stringify(writtenMessages)
      expect(serializedMessages).toContain('Session B cached answer')
      expect(serializedMessages).not.toContain('Session A persisted answer')
    }
  })

  it('does not cache an active session transcript under another active session during a switch', async () => {
    const sendA = createDeferred<void>()
    const sendB = createDeferred<void>()
    apiMock.sendMessage.mockReturnValueOnce(sendA.promise).mockReturnValueOnce(sendB.promise)

    const sessionA = SessionId('session-a')
    const sessionB = SessionId('session-b')
    const prompt = 'Draft a one-page summary of this app'

    const { result, rerender } = renderHook(
      ({
        sessionId,
        session,
      }: {
        readonly sessionId: SessionId
        readonly session: SessionDetail
      }) => useAgentChat(sessionId, session, SupportedModelId('claude-sonnet-4-5'), 'medium'),
      {
        initialProps: {
          sessionId: sessionA,
          session: createSessionWithIdAndMessages(sessionA, 1, []),
        },
      },
    )

    await act(async () => {
      void result.current.sendMessage({ ...SEND_PAYLOAD, text: 'Create a refactor plan' })
      await Promise.resolve()
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'agent_start',
          runId: 'run-a',
          timestamp: 1,
        },
      })
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'message_start',
          messageId: 'assistant-a',
          role: 'assistant',
          timestamp: 2,
        },
      })
      emitAgentEvent({
        sessionId: sessionA,
        event: {
          type: 'message_update',
          messageId: 'assistant-a',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'thinking_delta',
            contentIndex: 0,
            delta: 'Reasoning that belongs to session A',
          },
          timestamp: 3,
        },
      })
    })

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'assistant-a',
          parts: [
            {
              type: 'thinking',
              content: 'Reasoning that belongs to session A',
              stepId: 'assistant-a:thinking:0',
            },
          ],
        }),
      ]),
    )

    hasActiveRunMock.mockImplementation((id: SessionId) => id === sessionB)

    await act(async () => {
      rerender({
        sessionId: sessionB,
        session: createSessionWithIdAndMessages(sessionB, 1, []),
      })
      await Promise.resolve()
    })

    expect(runRenderSnapshots.get('session-b')?.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'assistant-a' })]),
    )
    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'assistant-a' })]),
    )

    hasActiveRunMock.mockReturnValue(false)

    await act(async () => {
      void result.current.sendMessage({ ...SEND_PAYLOAD, text: prompt })
      await Promise.resolve()
    })

    expect(result.current.messages.map(getUIMessageText)).toEqual([prompt])
    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'assistant-a' })]),
    )

    const sessionBRenderSnapshot = runRenderSnapshots.get('session-b')
    expect(sessionBRenderSnapshot?.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        parts: [{ type: 'text', content: prompt }],
      }),
    ])

    await act(async () => {
      sendA.resolve(undefined)
      sendB.resolve(undefined)
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

  it('merges background reconnect snapshots when stream events arrive before reconnect completes', async () => {
    hasActiveRunMock.mockReturnValue(true)
    const backgroundRun = createDeferred<BackgroundRunSnapshot>()
    apiMock.getSessionDetail.mockResolvedValue(
      createSessionWithMessages(1, [
        {
          id: MessageId('user-1'),
          role: 'user',
          createdAt: 1,
          parts: [{ type: 'text', text: 'Draft a summary' }],
        },
      ]),
    )
    apiMock.getBackgroundRun.mockReturnValue(backgroundRun.promise)

    const { result } = renderHook(() =>
      useAgentChat(
        SessionId('session-1'),
        createSessionWithMessages(1, [
          {
            id: MessageId('user-1'),
            role: 'user',
            createdAt: 1,
            parts: [{ type: 'text', text: 'Draft a summary' }],
          },
        ]),
        SupportedModelId('claude-sonnet-4-5'),
        'medium',
      ),
    )

    await waitFor(() => {
      expect(result.current.backgroundStreaming).toBe(true)
    })

    await act(async () => {
      emitAgentEvent({
        sessionId: SessionId('session-1'),
        event: {
          type: 'message_update',
          messageId: 'assistant-1',
          role: 'assistant',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: ' later',
          },
          timestamp: 3,
        },
      })
    })

    await act(async () => {
      backgroundRun.resolve({
        sessionId: SessionId('session-1'),
        model: SupportedModelId('claude-sonnet-4-5'),
        mode: 'classic',
        startedAt: 1,
        messageId: 'assistant-1',
        parts: [
          {
            type: 'tool-call',
            toolCall: {
              id: ToolCallId('tool-1'),
              name: 'read',
              args: { path: 'src/app.ts' },
              state: 'input-complete',
            },
          },
          {
            type: 'text',
            text: 'Earlier',
          },
        ],
      })
      await backgroundRun.promise
    })

    await waitFor(() => {
      const assistant = result.current.messages.find((message) => message.id === 'assistant-1')
      expect(assistant).toEqual(
        expect.objectContaining({
          role: 'assistant',
          parts: [
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'read',
              arguments: '{"path":"src/app.ts"}',
              state: 'input-complete',
            },
            {
              type: 'text',
              content: 'Earlier later',
            },
          ],
        }),
      )
    })
  })
})
