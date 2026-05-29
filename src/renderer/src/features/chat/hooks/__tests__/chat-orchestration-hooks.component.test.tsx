import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type { IpcEventChannelMap } from '@shared/types/ipc-events'
import type { WaggleConfig } from '@shared/types/waggle'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StreamingPhaseHandle } from '@/features/chat/hooks/useStreamingPhase'
import { useComposerStore } from '@/features/composer/state'
import { useBackgroundRunStore } from '../../state/background-run-store'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatStore } from '../../state/chat-store'
import { useBackgroundRunMonitor } from '../useBackgroundRunMonitor'
import { useChatSendWorkflow } from '../useChatSendWorkflow'
import { useComposerSection } from '../useComposerSection'
import { useSessionCopyWorkflow } from '../useSessionCopyWorkflow'

type AgentEventPayload = IpcEventChannelMap['agent:event']['payload']
type RunCompletedPayload = IpcEventChannelMap['agent:run-completed']['payload']
type AgentEventHandler = (payload: AgentEventPayload) => void
type RunCompletedHandler = (payload: RunCompletedPayload) => void

const apiMock = vi.hoisted(() => {
  let agentEventHandler: AgentEventHandler | null = null
  let runCompletedHandler: RunCompletedHandler | null = null
  const agentEventUnsubscribe = vi.fn()
  const runCompletedUnsubscribe = vi.fn()
  return {
    agentEventUnsubscribe,
    runCompletedUnsubscribe,
    getAgentEventHandler: () => agentEventHandler,
    getRunCompletedHandler: () => runCompletedHandler,
    listActiveRuns: vi.fn(),
    compactSession: vi.fn(),
    cancelWaggle: vi.fn(),
    cloneSessionToNew: vi.fn(),
    forkSessionToNew: vi.fn(),
    onAgentEvent: vi.fn((handler: AgentEventHandler) => {
      agentEventHandler = handler
      return agentEventUnsubscribe
    }),
    onRunCompleted: vi.fn((handler: RunCompletedHandler) => {
      runCompletedHandler = handler
      return runCompletedUnsubscribe
    }),
  }
})

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    cancelWaggle: apiMock.cancelWaggle,
    cloneSessionToNew: apiMock.cloneSessionToNew,
    compactSession: apiMock.compactSession,
    forkSessionToNew: apiMock.forkSessionToNew,
    listActiveRuns: apiMock.listActiveRuns,
    onAgentEvent: apiMock.onAgentEvent,
    onRunCompleted: apiMock.onRunCompleted,
  },
}))

const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('openai/gpt-5.5')

function requireAgentEventHandler() {
  const handler = apiMock.getAgentEventHandler()
  if (!handler) throw new Error('Expected agent event handler')
  return handler
}

function requireRunCompletedHandler() {
  const handler = apiMock.getRunCompletedHandler()
  if (!handler) throw new Error('Expected run-completed handler')
  return handler
}

function payload(text: string): AgentSendPayload {
  return { text, thinkingLevel: 'medium', attachments: [] }
}

function waggleConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: MODEL,
        roleDescription: 'Designs the solution',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SupportedModelId('anthropic/claude-sonnet-4'),
        roleDescription: 'Reviews the solution',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  }
}

function phaseHandle(current: StreamingPhaseHandle['current'] = null): StreamingPhaseHandle {
  return {
    current,
    completed: [],
    totalElapsedMs: 0,
    reset: vi.fn(),
  }
}

function sendWorkflowParams(overrides: Partial<Parameters<typeof useChatSendWorkflow>[0]> = {}) {
  const params = {
    activeSessionId: SESSION_ID,
    branchSummary: {
      materializeBranchSummary: vi.fn().mockResolvedValue(undefined),
      materializeDraftBranchForSend: vi.fn().mockResolvedValue(true),
    },
    clearDraftBranchForSession: vi.fn(),
    draftBranch: null,
    handleSend: vi.fn().mockResolvedValue(undefined),
    handleSendWaggle: vi.fn().mockResolvedValue(undefined),
    model: MODEL,
    phase: { reset: vi.fn() },
    refreshSession: vi.fn().mockResolvedValue(undefined),
    refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    sessionCopy: {
      forkSelectorOpen: false,
      forkTargets: [],
      closeForkSelector: vi.fn(),
      cloneCurrentSessionToNewSession: vi.fn().mockResolvedValue(undefined),
      forkMessageToNewSession: vi.fn().mockResolvedValue(undefined),
      openForkSelector: vi.fn(),
      selectForkTarget: vi.fn(),
    },
    setUserDidSend: vi.fn(),
    setWaggleConfig: vi.fn(),
    showToast: vi.fn(),
    startWaggleCollaboration: vi.fn(),
    stop: vi.fn(),
    stopWaggleCollaboration: vi.fn(),
    waggleConfig: null,
    waggleOwningId: null,
    waggleStatus: 'idle',
    ...overrides,
  } satisfies Parameters<typeof useChatSendWorkflow>[0]
  return params
}

describe('chat orchestration hooks', () => {
  beforeEach(() => {
    apiMock.listActiveRuns.mockReset()
    apiMock.compactSession.mockReset()
    apiMock.cancelWaggle.mockReset()
    apiMock.cloneSessionToNew.mockReset()
    apiMock.forkSessionToNew.mockReset()
    apiMock.onAgentEvent.mockClear()
    apiMock.onRunCompleted.mockClear()
    apiMock.agentEventUnsubscribe.mockClear()
    apiMock.runCompletedUnsubscribe.mockClear()
    useBackgroundRunStore.setState({
      activeRunIds: new Set(),
      renderSnapshotsBySessionId: new Map(),
    })
    useBranchSummaryStore.getState().clearPrompt()
    useChatStore.setState({
      activeSessionId: null,
      sessionById: new Map(),
      sessions: [],
    })
    useComposerStore.setState({ input: '', cursorIndex: 0, lexicalEditor: null })
  })

  it('tracks background run lifecycle events and clears snapshots after completion refresh', async () => {
    const refreshSession = vi.fn().mockResolvedValue(undefined)
    useChatStore.setState({ refreshSession })
    apiMock.listActiveRuns.mockResolvedValue([{ sessionId: SESSION_ID }])
    const { unmount } = renderHook(() => useBackgroundRunMonitor())

    await waitFor(() =>
      expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(true),
    )
    useBackgroundRunStore.getState().setRunRenderMessages(SESSION_ID, [])

    requireAgentEventHandler()({
      sessionId: SESSION_ID,
      event: { type: 'agent_end', runId: 'run-1', reason: 'stop' },
    })
    expect(useBackgroundRunStore.getState().hasActiveRun(SESSION_ID)).toBe(false)

    requireRunCompletedHandler()({ sessionId: SESSION_ID })
    await waitFor(() => expect(refreshSession).toHaveBeenCalledWith(SESSION_ID))
    await waitFor(() =>
      expect(useBackgroundRunStore.getState().getRunRenderSnapshot(SESSION_ID)).toBeNull(),
    )

    unmount()
    expect(apiMock.agentEventUnsubscribe).toHaveBeenCalledOnce()
    expect(apiMock.runCompletedUnsubscribe).toHaveBeenCalledOnce()
  })

  it('handles compact commands without sending a chat payload', async () => {
    apiMock.compactSession.mockResolvedValue(undefined)
    const params = sendWorkflowParams()
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await act(() => result.current.sendWithWaggle(payload('/compact retain decisions')))

    expect(apiMock.compactSession).toHaveBeenCalledWith(SESSION_ID, MODEL, 'retain decisions')
    expect(params.refreshSession).toHaveBeenCalledWith(SESSION_ID)
    expect(params.refreshSessionWorkspace).toHaveBeenCalledWith(SESSION_ID)
    expect(params.handleSend).not.toHaveBeenCalled()
  })

  it('sends through Waggle when an idle config belongs to the active session', async () => {
    const config = waggleConfig()
    const params = sendWorkflowParams({ waggleConfig: config })
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await act(() => result.current.sendWithWaggle(payload('Review the refactor')))

    expect(params.branchSummary.materializeDraftBranchForSend).toHaveBeenCalledWith(null)
    expect(params.startWaggleCollaboration).toHaveBeenCalledWith(SESSION_ID, config)
    expect(params.handleSendWaggle).toHaveBeenCalledWith(payload('Review the refactor'), config)
    expect(params.clearDraftBranchForSession).toHaveBeenCalledWith(SESSION_ID)
  })

  it('does not swallow first-message Waggle sends before a session exists', async () => {
    const config = waggleConfig()
    const params = sendWorkflowParams({ activeSessionId: null, waggleConfig: config })
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await act(() => result.current.sendWithWaggle(payload('Run the same prompt again')))

    expect(params.handleSendWaggle).toHaveBeenCalledWith(
      payload('Run the same prompt again'),
      config,
    )
    expect(params.startWaggleCollaboration).not.toHaveBeenCalled()
    expect(params.handleSend).not.toHaveBeenCalled()
  })

  it('cancels both Waggle collaboration and the active run when collaboration is running', () => {
    const params = sendWorkflowParams({ waggleStatus: 'running' })
    const { result } = renderHook(() => useChatSendWorkflow(params))

    act(() => result.current.cancelRun())

    expect(apiMock.cancelWaggle).toHaveBeenCalledWith(SESSION_ID)
    expect(params.stopWaggleCollaboration).toHaveBeenCalledOnce()
    expect(params.stop).toHaveBeenCalledOnce()
  })

  it('builds composer section state and inserts skill commands without a mounted Lexical editor', () => {
    useComposerStore.setState({ input: '/' })
    const startWaggle = vi.fn()
    const { result } = renderHook(() =>
      useComposerSection({
        isLoading: false,
        isSteering: false,
        status: 'ready',
        compactionStatus: null,
        activeSessionId: SESSION_ID,
        waggleStatus: 'idle',
        commandPaletteOpen: false,
        slashSkills: [],
        forkSelectorOpen: false,
        forkTargets: [],
        phase: phaseHandle({ label: 'Thinking', elapsedMs: 10 }),
        stop: vi.fn(),
        showToast: vi.fn(),
        handleSteer: vi.fn().mockResolvedValue(undefined),
        handleSendWithWaggle: vi.fn().mockResolvedValue(undefined),
        handleStartWaggle: startWaggle,
        handleStopCollaboration: vi.fn(),
        handleSkipBranchSummary: vi.fn(),
        handleSummarizeBranch: vi.fn(),
        handleStartCustomBranchSummary: vi.fn(),
        handleCancelBranchSummary: vi.fn(),
        handleOpenForkSelector: vi.fn(),
        handleCloseForkSelector: vi.fn(),
        handleSelectForkTarget: vi.fn(),
        handleCloneToNewSession: vi.fn(),
      }),
    )

    act(() => result.current.onSelectSkill('audit'))
    act(() => result.current.onStartWaggle(waggleConfig()))

    expect(result.current.isLoading).toBe(true)
    expect(useComposerStore.getState().input).toBe('/audit ')
    expect(useComposerStore.getState().cursorIndex).toBe('/audit '.length)
    expect(startWaggle).toHaveBeenCalledOnce()
  })

  it('keeps session copy commands safe when there is no active session or fork target', async () => {
    const showToast = vi.fn()
    const { result } = renderHook(() =>
      useSessionCopyWorkflow({
        activeSessionId: null,
        activeWorkspace: null,
        draftBranchSourceNodeId: SessionNodeId('draft-source'),
        model: MODEL,
        projectPath: '/repo',
        navigate: vi.fn(),
        setActiveSession: vi.fn(),
        loadSessions: vi.fn().mockResolvedValue(undefined),
        refreshSession: vi.fn().mockResolvedValue(undefined),
        refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
        showToast,
      }),
    )

    await act(() => result.current.cloneCurrentSessionToNewSession())
    act(() => result.current.openForkSelector())

    expect(showToast).toHaveBeenCalledWith('No active session to clone.')
    expect(showToast).toHaveBeenCalledWith('No user messages are available to fork.')
  })
})
