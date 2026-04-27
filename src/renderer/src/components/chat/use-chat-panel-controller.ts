import type { AgentSendPayload } from '@shared/types/agent'
import { type ConversationId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { parseCompactCommand } from '@/components/composer/compact-command'
import {
  type AgentChatStatus,
  type AgentCompactionStatus,
  useAgentChat,
} from '@/hooks/useAgentChat'
import { useAutoSendQueue } from '@/hooks/useAutoSendQueue'
import { useChat } from '@/hooks/useChat'
import { useConversationNav } from '@/hooks/useConversationNav'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { useSendMessage } from '@/hooks/useSendMessage'
import { useSkills } from '@/hooks/useSkills'
import { useStreamingPhase } from '@/hooks/useStreamingPhase'
import { useWaggleChat } from '@/hooks/useWaggleChat'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useSessionStore } from '@/stores/session-store'
import { useUIStore } from '@/stores/ui-store'
import { useWaggleStore } from '@/stores/waggle-store'
import { useComposerSection } from './hooks/useComposerSection'
import { useSteerWorkflow } from './hooks/useSteerWorkflow'
import { useTranscriptSection } from './hooks/useTranscriptSection'
import { reportAutoSendQueueFailure } from './queue-failure-feedback'
import type { ChatRow } from './types-chat-row'

const logger = createRendererLogger('chat-panel')

export interface ChatTranscriptSectionState {
  readonly messages: UIMessage[]
  readonly isLoading: boolean
  readonly projectPath: string | null
  readonly recentProjects: readonly string[]
  readonly activeConversationId: ConversationId | null
  readonly chatRows: ChatRow[]
  /** The ID of the last user message — used to identify stable session hydration for scroll restore. */
  readonly lastUserMessageId: string | null
  /** Monotonic streaming signal used by scroll-follow without rescanning the full transcript. */
  readonly streamSignalVersion: number
  /** Intent flag — true when user pressed Send, consumed by scroll hook. */
  readonly userDidSend: boolean
  /** Callback to clear userDidSend after the scroll effect processes it. */
  readonly onUserDidSendConsumed: () => void
  onOpenProject: () => Promise<void>
  onSelectProjectPath: (path: string) => void
  onRetryText: (content: string) => Promise<void>
  onOpenSettings: () => void
  onDismissError: (errorId: string | null) => void
  onBranchFromMessage: (messageId: string) => void
}

export interface ChatComposerSectionState {
  readonly activeConversationId: ConversationId | null
  readonly waggleStatus: WaggleCollaborationStatus
  readonly commandPaletteOpen: boolean
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly isLoading: boolean
  readonly status: AgentChatStatus
  readonly compactionStatus: AgentCompactionStatus | null
  onStopCollaboration: () => void
  onSelectSkill: (skillId: string, skillName?: string) => void
  onStartWaggle: (config: WaggleConfig) => void
  onSendWithWaggle: (payload: AgentSendPayload) => Promise<void>
  onSteer: (messageId: string) => Promise<void>
  onCancel: () => void
  onToast: (message: string) => void
}

export interface ChatDiffSectionState {
  readonly projectPath: string | null
  onSendMessage: (content: string) => Promise<void>
}

export interface ChatPanelSections {
  readonly transcript: ChatTranscriptSectionState
  readonly composer: ChatComposerSectionState
  readonly diff: ChatDiffSectionState
}

export function useChatPanelSections(): ChatPanelSections {
  // ── Intent-driven scroll flag ──
  const [userDidSend, setUserDidSend] = useState(false)

  function onUserDidSendConsumed(): void {
    setUserDidSend(false)
  }

  const navigate = useNavigate()
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const showToast = useUIStore((s) => s.showToast)

  const model = usePreferencesStore((s) => s.settings.selectedModel)
  const thinkingLevel = usePreferencesStore((s) => s.settings.thinkingLevel)
  const recentProjects = usePreferencesStore((s) => s.settings.recentProjects)

  const { projectPath, selectFolder, setProjectPath } = useProject()
  const {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    startDraftSession,
    setActiveConversation,
    refreshConversation,
  } = useChat()

  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const setDraftBranch = useSessionStore((state) => state.setDraftBranch)
  const clearDraftBranchForSession = useSessionStore((state) => state.clearDraftBranchForSession)
  const {
    handleOpenProject: handleOpenProjectNavigation,
    handleSelectProjectPath: handleSelectProjectPathNavigation,
  } = useConversationNav({
    conversations,
    projectPath,
    setActiveView,
    setProjectPath,
    selectFolder,
    startDraftSession,
    setActiveConversation,
    refreshGitStatus,
    refreshGitBranches,
  })

  async function handleOpenProject(): Promise<void> {
    await handleOpenProjectNavigation()
    void navigate({ to: '/' })
  }

  async function handleSelectProjectPath(path: string): Promise<void> {
    await handleSelectProjectPathNavigation(path)
    void navigate({ to: '/' })
  }

  function openSettings(): void {
    void navigate({ to: '/settings' })
  }

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
  } = useAgentChat(activeConversationId, activeConversation, model, thinkingLevel)

  const { handleSend, handleSendText, handleSendWaggle } = useSendMessage({
    activeConversationId,
    projectPath,
    thinkingLevel,
    createConversation,
    sendMessage,
    sendWaggleMessage,
  })

  useWaggleChat(activeConversationId)
  const phase = useStreamingPhase(activeConversationId)
  const { catalog } = useSkills(projectPath)

  const waggleStoreStatus = useWaggleStore((s) => s.status)
  const waggleConfig = useWaggleStore((s) => s.activeConfig)
  const waggleActiveCollaborationId = useWaggleStore((s) => s.activeCollaborationId)
  const waggleConfigConversationId = useWaggleStore((s) => s.configConversationId)
  const setWaggleConfig = useWaggleStore((s) => s.setConfig)
  const startWaggleCollaboration = useWaggleStore((s) => s.startCollaboration)
  const stopWaggleCollaboration = useWaggleStore((s) => s.stopCollaboration)

  // Scope waggle status to the active conversation — other conversations see 'idle'
  const waggleOwningId = waggleActiveCollaborationId ?? waggleConfigConversationId
  const waggleStatus: WaggleCollaborationStatus =
    waggleOwningId && waggleOwningId !== activeConversationId ? 'idle' : waggleStoreStatus

  async function materializeDraftBranchForSend(): Promise<boolean> {
    if (!activeConversationId) {
      return true
    }

    const sessionId = SessionId(String(activeConversationId))
    if (draftBranch?.sessionId !== sessionId) {
      return true
    }

    const navigation = await api.navigateSessionTree(sessionId, model, draftBranch.sourceNodeId)
    if (navigation.cancelled) {
      showToast('Branch source is no longer available.')
      return false
    }

    await refreshSessionWorkspace(sessionId, { nodeId: draftBranch.sourceNodeId })
    return true
  }

  async function handleSendWithWaggle(payload: AgentSendPayload): Promise<void> {
    const compactCommand = parseCompactCommand(payload.text)
    if (compactCommand) {
      await handleCompactSession(compactCommand.customInstructions)
      return
    }

    const draftBranchReady = await materializeDraftBranchForSend()
    if (!draftBranchReady) {
      return
    }

    setUserDidSend(true)
    phase.reset()

    try {
      const waggleReadyForThisConversation =
        waggleConfig &&
        waggleStatus === 'idle' &&
        (!waggleOwningId || waggleOwningId === activeConversationId)

      if (waggleReadyForThisConversation) {
        if (activeConversationId) {
          startWaggleCollaboration(activeConversationId, waggleConfig)
        }
        await handleSendWaggle(payload, waggleConfig)
      } else {
        await handleSend(payload)
      }
      if (activeConversationId) {
        clearDraftBranchForSession(SessionId(String(activeConversationId)))
      }
    } catch (sendError) {
      setUserDidSend(false)
      throw sendError
    }
  }

  async function handleCompactSession(customInstructions?: string): Promise<void> {
    if (!activeConversationId) {
      showToast('Nothing to compact yet.')
      return
    }

    try {
      await api.compactSession(activeConversationId, model, customInstructions)
      await Promise.all([
        refreshConversation(activeConversationId),
        refreshSessionWorkspace(SessionId(String(activeConversationId))),
      ])
    } catch (compactError) {
      const message = compactError instanceof Error ? compactError.message : String(compactError)
      showToast(message)
    }
  }

  function handleStartWaggle(config: WaggleConfig): void {
    setWaggleConfig(config, activeConversationId)
  }

  function handleStopCollaboration(): void {
    if (activeConversationId) {
      api.cancelWaggle(activeConversationId)
    }
    stopWaggleCollaboration()
  }

  function handleCancelRun(): void {
    if (activeConversationId && waggleStatus !== 'idle') {
      api.cancelWaggle(activeConversationId)
      stopWaggleCollaboration()
    }
    stop()
  }

  const { isSteering, handleSteer } = useSteerWorkflow({
    activeConversationId,
    steer,
    previewSteeredUserTurn,
    withDeferredSnapshotRefresh,
    handleSendWithWaggle,
    showToast,
  })

  useAutoSendQueue({
    conversationId: activeConversationId,
    status,
    sendMessage: handleSend,
    paused: isSteering,
    onSendFailure: (payload, sendError) => {
      reportAutoSendQueueFailure({ logger, showToast }, activeConversationId, payload, sendError)
    },
  })

  function handleBranchFromMessage(messageId: string): void {
    if (!activeConversationId) {
      return
    }

    const sessionId = SessionId(String(activeConversationId))
    const nodeId = SessionNodeId(messageId)
    setDraftBranch({ sessionId, sourceNodeId: nodeId })
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(sessionId) },
      search: (previous) => ({ ...previous, node: String(nodeId) }),
    })

    void refreshSessionWorkspace(sessionId, { nodeId })
  }

  const transcript = useTranscriptSection({
    messages,
    isLoading,
    isSteering,
    error,
    projectPath,
    recentProjects,
    activeConversationId,
    activeConversation,
    model,
    waggleStatus,
    phase,
    handleOpenProject,
    handleSelectProjectPath,
    handleSendText,
    openSettings,
    handleBranchFromMessage,
    userDidSend,
    onUserDidSendConsumed,
    streamSignalVersion,
  })

  const composer = useComposerSection({
    isLoading,
    isSteering,
    status,
    compactionStatus,
    activeConversationId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills: catalog?.skills ?? [],
    phase,
    stop: handleCancelRun,
    showToast,
    handleSteer,
    handleSendWithWaggle,
    handleStartWaggle,
    handleStopCollaboration,
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
