import { SessionId } from '@shared/types/brand'
import type { WaggleCollaborationStatus } from '@shared/types/waggle'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAgentChat } from '@/features/chat/hooks/useAgentChat'
import { useAutoSendQueue } from '@/features/chat/hooks/useAutoSendQueue'
import { useSendMessage } from '@/features/chat/hooks/useSendMessage'
import { useStreamingPhase } from '@/features/chat/hooks/useStreamingPhase'
import { useTurnReveal } from '@/features/chat/hooks/useTurnReveal'
import { createBranchDraftSelection } from '@/features/chat/lib/branch-from-message'
import { maybeOpenBranchSummaryPrompt } from '@/features/chat/lib/branch-summary-prompt-controller'
import { useComposerStore } from '@/features/composer/state'
import { useSkills } from '@/features/skills/hooks'
import { useWaggleChat } from '@/features/waggle/hooks'
import { useWaggleStore } from '@/features/waggle/state'
import { extensionContributionsQueryOptions } from '@/queries/extensions'
import { createRendererLogger } from '@/shared/lib/logger'
import { buildDiffSection } from '../lib/diff-section'
import { reportAutoSendQueueFailure } from '../lib/queue-failure-feedback'
import { setComposerSessionAuthorizationMode } from '../lib/session-authorization-mode-action'
import { sendStarterPrompt } from '../lib/starter-prompt-action'
import type { ChatPanelSections } from '../model'
import { useBranchSummaryWorkflow } from './useBranchSummaryWorkflow'
import { useChatPanelEnvironment } from './useChatPanelEnvironment'
import { useChatSendWorkflow } from './useChatSendWorkflow'
import { useComposerSection } from './useComposerSection'
import { useSessionCopyWorkflow } from './useSessionCopyWorkflow'
import { useSteerWorkflow } from './useSteerWorkflow'
import { useTranscriptSection } from './useTranscriptSection'

const logger = createRendererLogger('chat-panel')

export function useChatPanelSections(): ChatPanelSections {
  const [userDidSend, setUserDidSend] = useState(false)
  const onUserDidSendConsumed = () => setUserDidSend(false)

  const env = useChatPanelEnvironment()
  const {
    activeSessionId,
    activeSession,
    createSession,
    setActiveSession,
    refreshSession,
    setSessionAuthorizationMode,
  } = env.chat
  const {
    activeWorkspace,
    clearDraftBranchForSession,
    slashCommandMenuOpen,
    draftBranch,
    handleDismissInterruptedRun,
    handleOpenProject,
    handleSelectProjectPath,
    loadSessions,
    model,
    navigate,
    openSettings,
    projectPath,
    recentProjects,
    refreshSessionWorkspace,
    setDraftBranch,
    showToast,
    thinkingLevel,
  } = env

  const {
    messages,
    sendMessage,
    sendWaggleMessage,
    isLoading,
    status,
    stop,
    steer,
    error,
    withDeferredSnapshotRefresh,
    previewSteeredUserTurn,
    streamSignalVersion,
    compactionStatus,
    agentInteractions,
    agentCustomMessages,
    agentInteractionEvents,
    respondAgentInteraction,
  } = useAgentChat(activeSessionId, activeSession, model, thinkingLevel)

  const { handleSend, handleSendText, handleSendWaggle } = useSendMessage({
    activeSessionId,
    model,
    projectPath,
    thinkingLevel,
    createSession,
    sendMessage,
    sendWaggleMessage,
  })

  useWaggleChat(activeSessionId)
  const phase = useStreamingPhase(activeSessionId)
  const { catalog } = useSkills(projectPath)
  const extensionProjectPaths = projectPath ? [projectPath] : []
  const extensionContributionsQuery = useQuery(
    extensionContributionsQueryOptions(extensionProjectPaths, { sessionId: activeSessionId }),
  )
  const extensionRegistry = extensionContributionsQuery.data ?? null

  const waggleStoreStatus = useWaggleStore((s) => s.status)
  const waggleActiveCollaborationId = useWaggleStore((s) => s.activeCollaborationId)
  const waggleConfigSessionId = useWaggleStore((s) => s.configSessionId)
  const startWaggleCollaboration = useWaggleStore((s) => s.startCollaboration)
  const stopWaggleCollaboration = useWaggleStore((s) => s.stopCollaboration)

  // Scope waggle status to the active session — other sessions see 'idle'
  const waggleOwningId = waggleActiveCollaborationId ?? waggleConfigSessionId
  const waggleStatus: WaggleCollaborationStatus =
    waggleOwningId && waggleOwningId !== activeSessionId ? 'idle' : waggleStoreStatus
  const sessionCopy = useSessionCopyWorkflow({
    activeSessionId,
    activeWorkspace,
    draftBranchSourceNodeId: draftBranch?.sourceNodeId ?? null,
    model,
    projectPath,
    navigate,
    setActiveSession,
    loadSessions,
    refreshSession,
    refreshSessionWorkspace,
    showToast,
  })
  const branchSummary = useBranchSummaryWorkflow({
    activeSessionId,
    activeWorkspace,
    model,
    projectPath,
    navigate,
    loadSessions,
    refreshSession,
    refreshSessionWorkspace,
    clearDraftBranchForSession,
    showToast,
  })

  const sendWorkflow = useChatSendWorkflow({
    activeSessionId,
    branchSummary,
    clearDraftBranchForSession,
    draftBranch,
    extensionContributions: extensionContributionsQuery.data ?? null,
    handleSend,
    handleSendWaggle,
    messages,
    model,
    phase,
    projectPath,
    refreshSession,
    refreshSessionWorkspace,
    sessionCopy,
    setUserDidSend,
    showToast,
    startWaggleCollaboration,
    stop,
    stopWaggleCollaboration,
    waggleStatus,
  })

  const { isSteering, handleSteer } = useSteerWorkflow({
    activeSessionId,
    steer,
    previewSteeredUserTurn,
    withDeferredSnapshotRefresh,
    handleSendWithWaggle: sendWorkflow.sendWithWaggle,
    showToast,
  })

  useAutoSendQueue({
    sessionId: activeSessionId,
    status,
    sendMessage: handleSend,
    paused: isSteering,
    onSendFailure: (payload, sendError) =>
      reportAutoSendQueueFailure({ logger, showToast }, activeSessionId, payload, sendError),
  })

  function handleBranchFromMessage(messageId: string) {
    if (!activeSessionId) return
    const sessionId = SessionId(String(activeSessionId))
    const previousComposerText = useComposerStore.getState().input
    const selection = createBranchDraftSelection({
      messages,
      workspace: activeWorkspace,
      messageId,
    })
    const fallbackDraftText = selection.prefillText ?? ''
    setDraftBranch({ sessionId, sourceNodeId: selection.sourceNodeId })
    const draftComposerText = branchSummary.switchComposerToDraftBranch({
      sessionId,
      sourceNodeId: selection.sourceNodeId,
      fallbackText: fallbackDraftText,
    })
    maybeOpenBranchSummaryPrompt({
      sessionId,
      sourceNodeId: selection.sourceNodeId,
      restoreSelection: {
        branchId: activeWorkspace?.activeBranchId ?? null,
        nodeId: activeWorkspace?.activeNodeId ?? null,
      },
      previousComposerText,
      draftComposerText,
      activeWorkspace,
      projectPath,
    })
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(sessionId) },
      search: (previous) => ({
        ...previous,
        branch: undefined,
        node: String(selection.routeNodeId),
      }),
    })

    void refreshSessionWorkspace(sessionId, { nodeId: selection.routeNodeId })
  }

  const { turnAnchorMessageIds, handleViewTurnDiff } = useTurnReveal(
    activeSessionId,
    navigate,
    messages.length,
  )

  const transcript = useTranscriptSection({
    messages,
    customMessages: agentCustomMessages,
    interactionEvents: agentInteractionEvents,
    isLoading,
    isSteering,
    error,
    projectPath,
    recentProjects,
    activeSessionId,
    activeSession,
    model,
    waggleStatus,
    phase,
    extensionRegistry,
    extensionProjectPaths,
    handleOpenProject,
    handleSelectProjectPath,
    handleSendText: (content) => sendStarterPrompt({ content, model, handleSendText, showToast }),
    openSettings,
    handleDismissInterruptedRun,
    handleBranchFromMessage,
    handleForkFromMessage: (messageId: string) =>
      void sessionCopy.forkMessageToNewSession(messageId),
    handleViewTurnDiff,
    turnAnchorMessageIds,
    userDidSend,
    onUserDidSendConsumed,
    streamSignalVersion,
    compactionStatus,
  })

  const composer = useComposerSection({
    isLoading,
    isSteering,
    status,
    compactionStatus,
    forkSelectorOpen: sessionCopy.forkSelectorOpen,
    forkTargets: sessionCopy.forkTargets,
    activeSessionId,
    projectPath,
    recentProjects,
    session: activeSession,
    isFirstMessage: messages.length === 0,
    waggleStatus,
    slashCommandMenuOpen,
    slashSkills: catalog?.skills ?? [],
    phase,
    stop: sendWorkflow.cancelRun,
    showToast,
    handleSteer,
    handleSendWithWaggle: sendWorkflow.sendWithWaggle,
    handleStopCollaboration: sendWorkflow.stopCollaboration,
    handleSkipBranchSummary: branchSummary.skipBranchSummary,
    handleSummarizeBranch: () => void branchSummary.materializeBranchSummary(),
    handleStartCustomBranchSummary: branchSummary.startCustomBranchSummary,
    handleCancelBranchSummary: branchSummary.cancelBranchSummary,
    handleOpenForkSelector: sessionCopy.openForkSelector,
    handleCloseForkSelector: sessionCopy.closeForkSelector,
    handleSelectForkTarget: sessionCopy.selectForkTarget,
    handleCloneToNewSession: () => void sessionCopy.cloneCurrentSessionToNewSession(),
    handleOpenProject,
    handleSelectProjectPath,
    handleSetAuthorizationMode: (authorizationMode) =>
      setComposerSessionAuthorizationMode({
        activeSessionId,
        authorizationMode,
        setSessionAuthorizationMode,
        showToast,
      }),
  })

  return {
    transcript,
    composer,
    agentInteractions,
    agentCustomMessages,
    agentInteractionEvents,
    extensionRegistry,
    extensionProjectPaths,
    onRespondAgentInteraction: respondAgentInteraction,
    diff: buildDiffSection({
      activeSession,
      projectPath,
      sessionId: activeSessionId,
      onSendMessage: handleSendText,
    }),
  }
}
