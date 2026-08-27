import type { AgentSendPayload, AgentSendReport } from '@shared/types/agent'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { MessageId, SessionId, ToolCallId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'

/** The ordinary case: main ran the turn. */
const DELIVERED_REPORT = { outcome: 'delivered' } as const

const {
  apiMock,
  getRunRenderSnapshotMock,
  hasActiveRunMock,
  runRenderSnapshots,
  setRunRenderMessagesMock,
  setFirstSendRecoveryMock,
  firstSendRecoveryCalls,
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
    (sessionId: SessionId) => runRenderSnapshots.get(String(sessionId)) ?? null,
  )
  const setRunRenderMessagesMock = vi.fn((sessionId: SessionId, messages: readonly unknown[]) => {
    runRenderSnapshots.set(String(sessionId), {
      messages: [...messages],
      updatedAt: Date.now(),
    })
  })
  const hasActiveRunMock = vi.fn((_id: SessionId) => false)
  const firstSendRecoveryCalls: Array<readonly [SessionId, unknown]> = []
  const setFirstSendRecoveryMock = vi.fn((id: SessionId, recovery: unknown) => {
    firstSendRecoveryCalls.push([id, recovery])
  })
  const useBackgroundRunStoreMock = vi.fn(
    (
      selector: (state: {
        getRunRenderSnapshot: (sessionId: SessionId) => unknown
        hasActiveRun: (sessionId: SessionId) => boolean
        setRunRenderMessages: (sessionId: SessionId, messages: readonly unknown[]) => void
        setFirstSendRecovery: typeof setFirstSendRecoveryMock
      }) => unknown,
    ) =>
      selector({
        getRunRenderSnapshot: getRunRenderSnapshotMock,
        hasActiveRun: hasActiveRunMock,
        setRunRenderMessages: setRunRenderMessagesMock,
        setFirstSendRecovery: setFirstSendRecoveryMock,
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
      getBackgroundRun: vi.fn(async (): Promise<BackgroundRunSnapshot | null> => null),
      getSessionDetail: vi.fn(async (): Promise<SessionDetail | null> => null),
      /*
       * Both send channels report what became of the run. A harness that resolved with nothing described an
       * IPC contract that no longer exists, and the code under test would have read a refusal as a success.
       */
      sendMessage: vi.fn(async (): Promise<AgentSendReport> => DELIVERED_REPORT),
      sendWaggleMessage: vi.fn(async (): Promise<AgentSendReport> => DELIVERED_REPORT),
      cancelAgent: vi.fn(async (): Promise<void> => undefined),
      steerAgent: vi.fn(async () => ({ preserved: true })),
      respondAgentInteraction: vi.fn(async () => ({
        ok: true,
        interactionId: 'interaction-1',
        status: 'resolved',
      })),
    },
    runRenderSnapshots,
    getRunRenderSnapshotMock,
    setRunRenderMessagesMock,
    setFirstSendRecoveryMock,
    firstSendRecoveryCalls,
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
    apiMock.sendMessage.mockResolvedValue(DELIVERED_REPORT)
    apiMock.sendWaggleMessage.mockReset()
    apiMock.sendWaggleMessage.mockResolvedValue(DELIVERED_REPORT)
    apiMock.cancelAgent.mockReset()
    apiMock.cancelAgent.mockResolvedValue(undefined)
    apiMock.steerAgent.mockReset()
    apiMock.respondAgentInteraction.mockReset()
    apiMock.respondAgentInteraction.mockResolvedValue({
      ok: true,
      interactionId: 'interaction-1',
      status: 'resolved',
    })
    getRunRenderSnapshotMock.mockClear()
    hasActiveRunMock.mockReset()
    hasActiveRunMock.mockReturnValue(false)
    runRenderSnapshots.clear()
    setRunRenderMessagesMock.mockClear()
    setFirstSendRecoveryMock.mockClear()
    firstSendRecoveryCalls.length = 0
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
  firstSendRecoveryCalls,
  getRunRenderSnapshotMock,
  hasActiveRunMock,
  runRenderSnapshots,
  SEND_PAYLOAD,
  setRunRenderMessagesMock,
  useAgentChat,
}
