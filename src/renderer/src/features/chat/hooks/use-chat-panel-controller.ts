import { SessionId } from '@shared/types/brand'
import type { WaggleCollaborationStatus } from '@shared/types/waggle'
import { useState } from 'react'
import { useAgentChat } from '@/features/chat/hooks/useAgentChat'
import { useAutoSendQueue } from '@/features/chat/hooks/useAutoSendQueue'
import { useSendMessage } from '@/features/chat/hooks/useSendMessage'
import { useStreamingPhase } from '@/features/chat/hooks/useStreamingPhase'
import { createBranchDraftSelection } from '@/features/chat/lib/branch-from-message'
import { maybeOpenBranchSummaryPrompt } from '@/features/chat/lib/branch-summary-prompt-controller'
import { useComposerStore } from '@/features/composer/state'
import { useSkills } from '@/features/skills/hooks'
import { useWaggleChat } from '@/features/waggle/hooks'
import { useWaggleStore } from '@/features/waggle/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { reportAutoSendQueueFailure } from '../lib/queue-failure-feedback'
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
  // ── Intent-driven scroll flag ──
  const [userDidSend, setUserDidSend] = useState(false)

  function onUserDidSendConsumed() {
    setUserDidSend(false)
  }

  const env = useChatPanelEnvironment()
  const { activeSessionId, activeSession, createSession, setActiveSession, refreshSession } =
    env.chat
  const {
    activeWorkspace,
    clearDraftBranchForSession,
    commandPaletteOpen,
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

  async function handleStarterPrompt(content: string) {
    if (!model.trim()) {
      showToast('Select a model before sending.')
      return
    }

    try {
      await handleSendText(content)
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      logger.error('Failed to send starter prompt', { error: message })
      showToast(message)
    }
  }

  useWaggleChat(activeSessionId)
  const phase = useStreamingPhase(activeSessionId)
  const { catalog } = useSkills(projectPath)

  const waggleStoreStatus = useWaggleStore((s) => s.status)
  const waggleConfig = useWaggleStore((s) => s.activeConfig)
  const waggleActiveCollaborationId = useWaggleStore((s) => s.activeCollaborationId)
  const waggleConfigSessionId = useWaggleStore((s) => s.configSessionId)
  const setWaggleConfig = useWaggleStore((s) => s.setConfig)
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

  function handleForkFromMessage(messageId: string) {
    void sessionCopy.forkMessageToNewSession(messageId)
  }

  function handleCloneToNewSession() {
    void sessionCopy.cloneCurrentSessionToNewSession()
  }

  const sendWorkflow = useChatSendWorkflow({
    activeSessionId,
    branchSummary,
    clearDraftBranchForSession,
    draftBranch,
    handleSend,
    handleSendWaggle,
    model,
    phase,
    refreshSession,
    refreshSessionWorkspace,
    sessionCopy,
    setUserDidSend,
    setWaggleConfig,
    showToast,
    startWaggleCollaboration,
    stop,
    stopWaggleCollaboration,
    waggleConfig,
    waggleOwningId,
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
    onSendFailure: (payload, sendError) => {
      reportAutoSendQueueFailure({ logger, showToast }, activeSessionId, payload, sendError)
    },
  })

  function handleBranchFromMessage(messageId: string) {
    if (!activeSessionId) {
      return
    }

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

  const transcript = useTranscriptSection({
    messages,
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
    handleOpenProject,
    handleSelectProjectPath,
    handleSendText: handleStarterPrompt,
    openSettings,
    handleDismissInterruptedRun,
    handleBranchFromMessage,
    handleForkFromMessage,
    userDidSend,
    onUserDidSendConsumed,
    streamSignalVersion,
  })

  const composer = useComposerSection({
    isLoading,
    isSteering,
    status,
    compactionStatus,
    forkSelectorOpen: sessionCopy.forkSelectorOpen,
    forkTargets: sessionCopy.forkTargets,
    activeSessionId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills: catalog?.skills ?? [],
    phase,
    stop: sendWorkflow.cancelRun,
    showToast,
    handleSteer,
    handleSendWithWaggle: sendWorkflow.sendWithWaggle,
    handleStartWaggle: sendWorkflow.startWaggle,
    handleStopCollaboration: sendWorkflow.stopCollaboration,
    handleSkipBranchSummary: branchSummary.skipBranchSummary,
    handleSummarizeBranch: () => {
      void branchSummary.materializeBranchSummary()
    },
    handleStartCustomBranchSummary: branchSummary.startCustomBranchSummary,
    handleCancelBranchSummary: branchSummary.cancelBranchSummary,
    handleOpenForkSelector: sessionCopy.openForkSelector,
    handleCloseForkSelector: sessionCopy.closeForkSelector,
    handleSelectForkTarget: sessionCopy.selectForkTarget,
    handleCloneToNewSession,
  })

  return {
    transcript,
    composer,
    diff: {
      projectPath,
      onSendMessage: handleSendText,
    },
  }
}
