import type { AgentSendReport } from '@shared/types/agent'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import type { SessionDetail } from '@shared/types/session'
import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { useAgentLoopEventStore } from '../../state/agent-loop-event-store'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'
import { recordPendingInteractionEvent } from './pending-interaction-test-state'

type AgentEventPayload = IpcEventChannelMap['agent:event']['payload']

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
  pendingInteractionsBySessionId,
  runCompletedHandlers,
} = vi.hoisted(() => {
  const agentEventHandlers: Array<(payload: unknown) => void> = []
  const pendingInteractionsBySessionId = new Map<string, readonly unknown[]>()
  const runCompletedHandlers: Array<(payload: unknown) => void> = []
  const runRenderSnapshots = new Map<
    string,
    { readonly messages: readonly unknown[]; compactionStatus: unknown; updatedAt: number }
  >()
  const getRunRenderSnapshotMock = vi.fn(
    (sessionId: SessionId) => runRenderSnapshots.get(String(sessionId)) ?? null,
  )
  const setRunRenderMessagesMock = vi.fn((sessionId: SessionId, messages: readonly unknown[]) => {
    runRenderSnapshots.set(String(sessionId), {
      messages: [...messages],
      compactionStatus: runRenderSnapshots.get(String(sessionId))?.compactionStatus ?? null,
      updatedAt: Date.now(),
    })
  })
  const setRunCompactionStatusMock = vi.fn((sessionId: SessionId, compactionStatus: unknown) => {
    const existing = runRenderSnapshots.get(String(sessionId))
    if (!existing) return
    runRenderSnapshots.set(String(sessionId), { ...existing, compactionStatus })
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
        setRunCompactionStatus: (sessionId: SessionId, status: unknown) => void
        setFirstSendRecovery: typeof setFirstSendRecoveryMock
      }) => unknown,
    ) =>
      selector({
        getRunRenderSnapshot: getRunRenderSnapshotMock,
        hasActiveRun: hasActiveRunMock,
        setRunRenderMessages: setRunRenderMessagesMock,
        setRunCompactionStatus: setRunCompactionStatusMock,
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
      querySessionControl: vi.fn(
        async (request: {
          readonly requestId: string
          readonly query: { readonly sessionId: string }
        }) => ({
          contractVersion: 2,
          requestId: request.requestId,
          outcome: {
            operation: 'requests-list',
            sessionId: request.query.sessionId,
            requests: pendingInteractionsBySessionId.get(request.query.sessionId) ?? [],
          },
        }),
      ),
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
    pendingInteractionsBySessionId,
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

function emitAgentEvent(payload: AgentEventPayload) {
  if (
    payload.event.type !== 'agent_interaction_request' ||
    payload.event.interaction.kind !== 'notify'
  ) {
    recordPendingInteractionEvent(pendingInteractionsBySessionId, payload)
  }
  // WorkspaceShell owns the durable session-scoped event listener in production. This focused hook
  // harness mirrors that listener while still delivering the event to useAgentChat's stream logic.
  useAgentLoopEventStore.getState().applyEvent(payload.sessionId, payload.event)
  for (const handler of agentEventHandlers) {
    handler(payload)
  }
}

function emitRunCompleted(payload: unknown) {
  for (const handler of runCompletedHandlers) {
    handler(payload)
  }
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
    apiMock.querySessionControl.mockReset()
    apiMock.querySessionControl.mockImplementation(
      async (request: {
        readonly requestId: string
        readonly query: { readonly sessionId: string }
      }) => ({
        contractVersion: 2 as const,
        requestId: request.requestId,
        outcome: {
          operation: 'requests-list' as const,
          sessionId: request.query.sessionId,
          requests: pendingInteractionsBySessionId.get(request.query.sessionId) ?? [],
        },
      }),
    )
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
    pendingInteractionsBySessionId.clear()
    runCompletedHandlers.length = 0
    useAgentLoopEventStore.setState({ sessionsById: new Map() })
    useOptimisticUserMessageStore.setState({ messagesBySessionId: new Map() })
  })
}

export {
  createDeferred,
  createSession,
  createSessionWithId,
  createSessionWithIdAndMessages,
  createSessionWithMessages,
  SEND_PAYLOAD,
} from './useAgentChat.test-fixtures'
export {
  apiMock,
  emitAgentEvent,
  emitRunCompleted,
  firstSendRecoveryCalls,
  getRunRenderSnapshotMock,
  hasActiveRunMock,
  runRenderSnapshots,
  setRunRenderMessagesMock,
  useAgentChat,
}
