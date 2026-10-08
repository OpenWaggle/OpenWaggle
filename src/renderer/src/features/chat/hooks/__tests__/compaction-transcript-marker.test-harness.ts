import { SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionWorkspace } from '@shared/types/session'
import { act, renderHook } from '@testing-library/react'
import { vi } from 'vitest'
import type { ChatRow } from '../../lib/types-chat-row'
import type { LogEntry } from './compaction-marker-transcript.fixtures'
import {
  emit,
  getWorkerTranscriptMocks,
  loadWorkerTranscriptHooks,
  MODEL,
  resetWorkerTranscriptState,
  settle,
  WORKER_ID,
} from './worker-session-transcript.test-harness'

/** The real chat hook and transcript section of one chat route, over the mocked IPC bridge. */

const { useAgentChat, useBackgroundRunMonitor } = await loadWorkerTranscriptHooks()

export { useBackgroundRunMonitor }

const { apiMock } = getWorkerTranscriptMocks()
const { useBackgroundRunStore } = await import('../../state/background-run-store')
const { useSessionStore } = await import('@/features/sessions/state')
const { useTranscriptSection } = await import('../useTranscriptSection')

export const HISTORY: readonly LogEntry[] = [
  { id: 'user-1', kind: 'user' },
  { id: 'assistant-1', kind: 'assistant' },
  { id: 'user-2', kind: 'user' },
  { id: 'assistant-2', kind: 'assistant' },
]
export const ALL_HISTORY = HISTORY.map((entry) => entry.id)

export const OTHER_ID = SessionId('other-session')
export const OTHER_LOG: readonly LogEntry[] = [
  { id: 'other-user', kind: 'user' },
  { id: 'other-assistant', kind: 'assistant' },
]

const phase = { current: null, completed: [], totalElapsedMs: 0, reset: vi.fn() }

interface OpenedSession {
  readonly sessionId: SessionId
  readonly session: SessionDetail
}

function useChatTranscript({ sessionId, session }: OpenedSession) {
  const chat = useAgentChat(sessionId, session, MODEL)
  const transcript = useTranscriptSection({
    messages: chat.messages,
    customMessages: [],
    interactionEvents: [],
    isLoading: chat.isLoading,
    isSteering: false,
    error: chat.error,
    streamSignalVersion: chat.streamSignalVersion,
    projectPath: '/tmp/project',
    recentProjects: [],
    activeSessionId: sessionId,
    activeSession: session,
    model: MODEL,
    waggleStatus: 'idle',
    phase,
    extensionRegistry: null,
    extensionProjectPaths: [],
    handleOpenProject: vi.fn(),
    handleSelectProjectPath: vi.fn(),
    handleSendText: vi.fn(),
    openSettings: vi.fn(),
    handleBranchFromMessage: vi.fn(),
    handleForkFromMessage: vi.fn(),
    handleDismissInterruptedRun: vi.fn(),
    pendingSend: null,
    onPendingSendConsumed: vi.fn(),
    handleViewTurnDiff: vi.fn(),
    turnAnchorMessageIds: new Set<string>(),
    turnsByAnchorNodeId: new Map(),
    compactionStatus: chat.compactionStatus,
  })
  return { chat, rows: transcript.chatRows }
}

/** A message row by its text: a reconciled user row keeps its live id. */
export function rowLabel(row: ChatRow) {
  if (row.type === 'message') {
    return row.message.parts.map((part) => (part.type === 'text' ? part.content : '')).join('')
  }
  if (row.type === 'compaction-summary') return `marker:${row.reason ?? 'legacy'}`
  if (row.type === 'compaction-status') return `live:${row.state}`
  return row.type
}

export function setWorkspace(workspace: SessionWorkspace) {
  act(() => useSessionStore.getState().setActiveWorkspace(workspace))
}

export function openSession(session: SessionDetail) {
  return renderHook((opened: OpenedSession) => useChatTranscript(opened), {
    initialProps: { sessionId: WORKER_ID, session },
  })
}

/** What `/compact` does in the composer: snapshot the transcript, then the Host compacts. */
export function startManualCompaction(messages: ReturnType<typeof useAgentChat>['messages']) {
  act(() => {
    useBackgroundRunStore.getState().setRunRenderMessages(WORKER_ID, messages)
    emit({ type: 'compaction_start', reason: 'manual', timestamp: 20 })
  })
}

/** The Host publishes the end after persisting, and the bridge settles the standalone activity. */
export async function finishManualCompaction() {
  act(() => {
    emit({
      type: 'compaction_end',
      reason: 'manual',
      result: { entryId: 'compaction-1' },
      aborted: false,
      willRetry: false,
      timestamp: 21,
    })
    for (const handler of [...apiMock.runCompletedHandlers]) handler({ sessionId: WORKER_ID })
  })
  await settle()
}

export function resetState() {
  resetWorkerTranscriptState()
  apiMock.getBackgroundRun.mockResolvedValue(null)
  useSessionStore.setState({ ...useSessionStore.getInitialState(), activeWorkspace: null })
}
