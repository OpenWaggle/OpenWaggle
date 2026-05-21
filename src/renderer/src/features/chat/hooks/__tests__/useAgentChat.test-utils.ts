import type { AgentSendPayload } from '@shared/types/agent'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'

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
} = vi.hoisted(() => {
  const agentEventHandlers: Array<(payload: unknown) => void> = []
  const runCompletedHandlers: Array<(payload: unknown) => void> = []
  const runRenderSnapshots = new Map<
    string,
    { readonly messages: readonly unknown[]; updatedAt: number }
  >()
  const getRunRenderSnapshotMock = vi.fn(
    (sessionId: string) => runRenderSnapshots.get(String(sessionId)) ?? null,
  )
  const setRunRenderMessagesMock = vi.fn((sessionId: string, messages: readonly unknown[]) => {
    runRenderSnapshots.set(String(sessionId), {
      messages: [...messages],
      updatedAt: Date.now(),
    })
  })
  const hasActiveRunMock = vi.fn(() => false)
  const useBackgroundRunStoreMock = vi.fn(
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
  )
  const upsertSessionMock = vi.fn()
  const useChatStoreMock = vi.fn(
    (selector: (state: { upsertSession: (value: unknown) => void }) => unknown) =>
      selector({ upsertSession: upsertSessionMock }),
  )

  return {
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
    runRenderSnapshots,
    getRunRenderSnapshotMock,
    setRunRenderMessagesMock,
    hasActiveRunMock,
    useBackgroundRunStoreMock,
    upsertSessionMock,
    useChatStoreMock,
    agentEventHandlers,
    runCompletedHandlers,
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

vi.mock('@/features/chat/state/background-run-store', () => ({
  useBackgroundRunStore: useBackgroundRunStoreMock,
}))

vi.mock('@/features/chat/state/chat-store', () => ({
  useChatStore: useChatStoreMock,
}))

const { useAgentChat } = await import('../useAgentChat')

function emitAgentEvent(payload: unknown) {
  for (const handler of agentEventHandlers) {
    handler(payload)
  }
}

function emitRunCompleted(payload: unknown) {
  for (const handler of runCompletedHandlers) {
    handler(payload)
  }
}

function createSession() {
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

function createSessionWithMessages(updatedAt: number, messages: SessionDetail['messages']) {
  return {
    id: SessionId('session-1'),
    title: 'SessionDetail',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt,
    messages,
  }
}

function createSessionWithId(id: SessionId) {
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
) {
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

function createDeferred<T>() {
  let resolveValue = (_value: T) => {}
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })

  return { promise, resolve: resolveValue }
}

export function installUseAgentChatTestLifecycle() {
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
}

export {
  apiMock,
  createDeferred,
  createSession,
  createSessionWithId,
  createSessionWithIdAndMessages,
  createSessionWithMessages,
  emitAgentEvent,
  emitRunCompleted,
  getRunRenderSnapshotMock,
  hasActiveRunMock,
  runRenderSnapshots,
  SEND_PAYLOAD,
  setRunRenderMessagesMock,
  useAgentChat,
}
