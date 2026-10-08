import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import type { SessionDetail } from '@shared/types/session'
import { act, cleanup } from '@testing-library/react'
import { vi } from 'vitest'
import { useAgentLoopEventStore } from '../../state/agent-loop-event-store'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store'

/*
 * A Worker Session is spawned by its Queen and runs while the user looks at another Session. The
 * renderer never opened it, so it had no route-owned render snapshot. Its Run is persisted only when
 * it ends, and the reconnect buffer keeps only the answer it is streaming now. This harness drives
 * the real background monitor and chat hook over a mocked IPC bridge.
 */

type AgentEventPayload = IpcEventChannelMap['agent:event']['payload']
type AgentEventHandler = (payload: AgentEventPayload) => void
type RunCompletedPayload = IpcEventChannelMap['agent:run-completed']['payload']
type RunCompletedHandler = (payload: RunCompletedPayload) => void

const apiMock = vi.hoisted(() => {
  const agentEventHandlers: AgentEventHandler[] = []
  const runCompletedHandlers: RunCompletedHandler[] = []
  function subscribe<Handler>(handlers: Handler[]) {
    return (handler: Handler) => {
      handlers.push(handler)
      return () => {
        const index = handlers.indexOf(handler)
        if (index >= 0) handlers.splice(index, 1)
      }
    }
  }
  return {
    agentEventHandlers,
    runCompletedHandlers,
    onAgentEvent: vi.fn(subscribe(agentEventHandlers)),
    onRunCompleted: vi.fn(subscribe(runCompletedHandlers)),
    onSessionHostResyncRequired: vi.fn((_handler: () => void) => () => {}),
    listActiveRuns: vi.fn(async () => []),
    getBackgroundRun: vi.fn(
      async (_sessionId: string): Promise<BackgroundRunSnapshot | null> => null,
    ),
    getSessionDetail: vi.fn(async (): Promise<SessionDetail | null> => null),
    querySessionControl: vi.fn(
      async (request: {
        readonly requestId: string
        readonly query: { readonly sessionId: string }
      }) => ({
        contractVersion: 2,
        requestId: request.requestId,
        outcome: { operation: 'requests-list', sessionId: request.query.sessionId, requests: [] },
      }),
    ),
  }
})

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))

const chatStoreMock = vi.hoisted(() => ({
  refreshSession: vi.fn(async (_sessionId: string) => {}),
}))

vi.mock('@/features/chat/state/chat-store', () => ({
  useChatStore: (
    selector: (state: {
      readonly upsertSession: () => void
      readonly refreshSession: (sessionId: string) => Promise<void>
    }) => unknown,
  ) => selector({ upsertSession: () => {}, refreshSession: chatStoreMock.refreshSession }),
}))

/** The mocked IPC bridge and chat store; hoisted values cannot be exported directly. */
export function getWorkerTranscriptMocks() {
  return { apiMock, chatStoreMock }
}

export async function loadWorkerTranscriptHooks() {
  const { useAgentChat } = await import('../useAgentChat')
  const { useBackgroundRunMonitor } = await import('../useBackgroundRunMonitor')
  return { useAgentChat, useBackgroundRunMonitor }
}

export const WORKER_ID = SessionId('worker-session')
export const MODEL = SupportedModelId('claude-sonnet-4-5')
export const INITIAL_PROMPT = 'Diagnose the transcript bug'

/** The Worker's render snapshot in the real background run store. */
export function workerRunRenderSnapshot() {
  return useBackgroundRunStore.getState().getRunRenderSnapshot(WORKER_ID)
}

export function emit(event: AgentEventPayload['event']) {
  const payload: AgentEventPayload = { sessionId: WORKER_ID, event }
  useAgentLoopEventStore.getState().applyEvent(payload.sessionId, payload.event)
  for (const handler of [...apiMock.agentEventHandlers]) handler(payload)
}

/** `continues`: the Session went straight on to a queued Follow-up. */
export function completeRun(runId: string, options: { readonly continues?: true } = {}) {
  for (const handler of [...apiMock.runCompletedHandlers]) {
    handler({ sessionId: WORKER_ID, runId, terminalStatus: 'completed', ...options })
  }
}

export function emitAssistantText(messageId: string, text: string, timestamp: number) {
  emit({ type: 'message_start', messageId, role: 'assistant', timestamp })
  emit({
    type: 'message_update',
    messageId,
    role: 'assistant',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text },
    timestamp: timestamp + 1,
  })
}

/** What the Host can answer mid-Run: nothing of this Run is persisted yet. */
export function workerDetailWithoutRunMessages(): SessionDetail {
  return {
    id: WORKER_ID,
    title: 'Worker',
    projectPath: '/tmp/project',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
  }
}

/** The reconnect buffer keeps the Run's user messages and only the answer streaming now. */
export function workerReconnectBuffer(): BackgroundRunSnapshot {
  return {
    activity: 'agent-run',
    sessionId: WORKER_ID,
    model: MODEL,
    mode: 'classic',
    startedAt: 1,
    activityEvents: [],
    messageId: 'live-assistant-3',
    parts: [{ type: 'text', text: 'Writing the fix' }],
    userMessages: [
      {
        messageId: 'live-user-1',
        parts: [{ type: 'text', text: INITIAL_PROMPT }],
        sessionNodeCreatedOrder: 2,
        timestamp: 2,
      },
    ],
  }
}

export function transcriptText(messages: readonly UIMessage[]) {
  return messages.map((message) => [
    message.role,
    message.parts
      .map((part) =>
        part.type === 'text' ? part.content : part.type === 'tool-call' ? `tool:${part.name}` : '',
      )
      .filter((value) => value.length > 0)
      .join(' | '),
  ])
}

export function resetWorkerTranscriptState() {
  apiMock.agentEventHandlers.length = 0
  apiMock.runCompletedHandlers.length = 0
  chatStoreMock.refreshSession.mockReset().mockResolvedValue(undefined)
  apiMock.getSessionDetail.mockReset().mockResolvedValue(workerDetailWithoutRunMessages())
  apiMock.getBackgroundRun.mockReset().mockResolvedValue(workerReconnectBuffer())
  apiMock.listActiveRuns.mockReset().mockResolvedValue([])
  useBackgroundRunStore.setState({
    activeRunIds: new Set(),
    runModelBySessionId: new Map(),
    renderSnapshotsBySessionId: new Map(),
    worktreeLaunchBySessionId: new Map(),
    firstSendRecoveryBySessionId: new Map(),
  })
  useAgentLoopEventStore.setState({ sessionsById: new Map() })
  useOptimisticUserMessageStore.setState({ messagesBySessionId: new Map() })
}

export async function cleanupWorkerTranscript() {
  await act(async () => {
    cleanup()
    await Promise.resolve()
  })
}

/** Lets the monitor's mount effects and pending promise callbacks run. */
export async function settle() {
  await act(async () => {
    await Promise.resolve()
  })
}
