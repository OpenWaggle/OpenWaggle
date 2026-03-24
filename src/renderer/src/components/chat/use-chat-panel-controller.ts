import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useAgentChat } from '@/hooks/useAgentChat'
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
import { useUIStore } from '@/stores/ui-store'
import { useWaggleStore } from '@/stores/waggle-store'
import { useComposerSection } from './hooks/useComposerSection'
import { useSteerWorkflow } from './hooks/useSteerWorkflow'
import { useTranscriptSection } from './hooks/useTranscriptSection'
import type {
  ApprovalResponseAction,
  PendingApproval,
  PendingAskUser,
} from './pending-tool-interactions'
import { reportAutoSendQueueFailure } from './queue-failure-feedback'
import type { ChatRow } from './types-chat-row'

const logger = createRendererLogger('chat-panel')

export interface ChatTranscriptSectionState {
  readonly messages: UIMessage[]
  readonly isLoading: boolean
  /** When true, keep the user-send anchor stable and disable bottom-follow autoscroll. */
  readonly disableAutoFollowDuringWaggleStreaming: boolean
  readonly projectPath: string | null
  readonly recentProjects: readonly string[]
  readonly activeConversationId: ConversationId | null
  readonly chatRows: ChatRow[]
  /** The ID of the last user message. ChatTranscript watches this reactively
   *  (Voyager pattern) and scrolls when it changes to a new unseen ID. */
  readonly lastUserMessageId: string | null
  onOpenProject: () => Promise<void>
  onSelectProjectPath: (path: string) => void
  onRetryText: (content: string) => Promise<void>
  onAnswerQuestion: ReturnType<typeof useAgentChat>['answerQuestion']
  onRespondToPlan: ReturnType<typeof useAgentChat>['respondToPlan']
  onOpenSettings: () => void
  onDismissError: (errorId: string | null) => void
}

export interface ChatComposerSectionState {
  readonly pendingApproval: PendingApproval | null
  readonly pendingAskUser: PendingAskUser | null
  readonly activeConversationId: ConversationId | null
  readonly waggleStatus: WaggleCollaborationStatus
  readonly commandPaletteOpen: boolean
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly isLoading: boolean
  readonly status: 'ready' | 'submitted' | 'streaming' | 'error'
  onToolApprovalResponse: (
    pendingApproval: PendingApproval,
    response: ApprovalResponseAction,
  ) => Promise<void>
  onAnswerQuestion: ReturnType<typeof useAgentChat>['answerQuestion']
  onStopCollaboration: () => void
  onSelectSkill: (skillId: string) => void
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
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const openSettings = useUIStore((s) => s.openSettings)
  const showToast = useUIStore((s) => s.showToast)

  const model = usePreferencesStore((s) => s.settings.defaultModel)
  const qualityPreset = usePreferencesStore((s) => s.settings.qualityPreset)
  const recentProjects = usePreferencesStore((s) => s.settings.recentProjects)
  const executionMode = usePreferencesStore((s) => s.settings.executionMode)

  const { projectPath, selectFolder, setProjectPath } = useProject()
  const {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    startDraftThread,
    setActiveConversation,
    updateConversationProjectPath,
  } = useChat()

  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()
  const { handleOpenProject, handleSelectProjectPath } = useConversationNav({
    conversations,
    activeConversationId,
    projectPath,
    setActiveView,
    setProjectPath,
    selectFolder,
    createConversation,
    startDraftThread,
    setActiveConversation,
    updateConversationProjectPath,
    refreshGitStatus,
    refreshGitBranches,
  })

  const {
    messages,
    sendMessage,
    sendWaggleMessage,
    isLoading,
    status,
    stop,
    steer,
    error,
    respondToolApproval,
    answerQuestion,
    respondToPlan,
    withDeferredSnapshotRefresh,
    previewSteeredUserTurn,
  } = useAgentChat(activeConversationId, activeConversation, model, qualityPreset)

  const { handleSend, handleSendText, handleSendWaggle } = useSendMessage({
    activeConversationId,
    projectPath,
    qualityPreset,
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

  const trustProjectPath = activeConversation?.projectPath ?? projectPath

  async function handleSendWithWaggle(payload: AgentSendPayload): Promise<void> {
    phase.reset()

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
    answerQuestion,
    respondToPlan,
    openSettings,
  })

  const composer = useComposerSection({
    messages,
    isLoading,
    isSteering,
    status,
    activeConversationId,
    trustProjectPath,
    executionMode,
    waggleStatus,
    commandPaletteOpen,
    slashSkills: catalog?.skills ?? [],
    phase,
    activeConversation,
    respondToolApproval,
    answerQuestion,
    stop,
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
