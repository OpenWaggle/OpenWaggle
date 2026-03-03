import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useState } from 'react'
import { useAgentChat } from '@/hooks/useAgentChat'
import { useAgentPhase } from '@/hooks/useAgentPhase'
import { useAutoSendQueue } from '@/hooks/useAutoSendQueue'
import { useChat } from '@/hooks/useChat'
import { useConversationNav } from '@/hooks/useConversationNav'
import { useGit } from '@/hooks/useGit'
import { useMessageModelLookup } from '@/hooks/useMessageModelLookup'
import { useProject } from '@/hooks/useProject'
import { useSendMessage } from '@/hooks/useSendMessage'
import { useSkills } from '@/hooks/useSkills'
import { useStreamingPhase } from '@/hooks/useStreamingPhase'
import { useWaggleChat } from '@/hooks/useWaggleChat'
import { useWaggleMetadataLookup } from '@/hooks/useWaggleMetadataLookup'
import { api } from '@/lib/ipc'
import { useComposerStore } from '@/stores/composer-store'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useUIStore } from '@/stores/ui-store'
import { useWaggleStore } from '@/stores/waggle-store'
import {
  findPendingApproval,
  findPendingAskUser,
  type PendingApproval,
  type PendingAskUser,
} from './pending-tool-interactions'
import type { VirtualRow } from './types-virtual'
import { buildVirtualRows } from './useVirtualRows'

export interface ChatTranscriptSectionState {
  readonly messages: UIMessage[]
  readonly isLoading: boolean
  readonly projectPath: string | null
  readonly recentProjects: readonly string[]
  readonly activeConversationId: ConversationId | null
  readonly virtualRows: VirtualRow[]
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
  onToolApprovalResponse: ReturnType<typeof useAgentChat>['respondToolApproval']
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

function resolveLastUserMessage(messages: UIMessage[]): string | null {
  let lastUserMessage: UIMessage | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && message.role === 'user') {
      lastUserMessage = message
      break
    }
  }
  if (!lastUserMessage) {
    return null
  }

  const content = lastUserMessage.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.content)
    .join('\n')

  return content || null
}

export function useChatPanelSections(): ChatPanelSections {
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const openSettings = useUIStore((s) => s.openSettings)
  const showToast = useUIStore((s) => s.showToast)

  const model = usePreferencesStore((s) => s.settings.defaultModel)
  const qualityPreset = usePreferencesStore((s) => s.settings.qualityPreset)
  const recentProjects = usePreferencesStore((s) => s.settings.recentProjects)

  const { projectPath, selectFolder, setProjectPath } = useProject()
  const {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
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
  } = useAgentChat(activeConversationId, activeConversation, model, qualityPreset)

  const { handleSend, handleSendText, handleSendWaggle } = useSendMessage({
    activeConversationId,
    projectPath,
    qualityPreset,
    createConversation,
    sendMessage,
    sendWaggleMessage,
  })

  const messageModelLookup = useMessageModelLookup(activeConversation)
  const waggleMetadataLookup = useWaggleMetadataLookup(activeConversation, messages)
  useWaggleChat(activeConversationId)

  const agentPhase = useAgentPhase(activeConversationId)
  const phase = useStreamingPhase(agentPhase)

  const { catalog } = useSkills(projectPath)

  const waggleStatus = useWaggleStore((s) => s.status)
  const waggleConfig = useWaggleStore((s) => s.activeConfig)
  const setWaggleConfig = useWaggleStore((s) => s.setConfig)
  const startWaggleCollaboration = useWaggleStore((s) => s.startCollaboration)
  const stopWaggleCollaboration = useWaggleStore((s) => s.stopCollaboration)

  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [isSteering, setIsSteering] = useState(false)

  useAutoSendQueue({
    conversationId: activeConversationId,
    status,
    sendMessage: handleSend,
    paused: isSteering,
  })

  const lastUserMessage = resolveLastUserMessage(messages)

  const virtualRows = buildVirtualRows({
    messages,
    isLoading: isLoading || isSteering,
    error,
    lastUserMessage,
    dismissedError,
    conversationId: activeConversationId,
    model,
    messageModelLookup,
    waggleMetadataLookup,
    phase,
  })

  const pendingApproval = findPendingApproval(messages)
  const pendingAskUser = findPendingAskUser(messages)

  function handleSelectSkill(skillId: string): void {
    const composerStore = useComposerStore.getState()
    const currentInput = composerStore.input
    const nextInput = currentInput === '/' ? `/${skillId} ` : `/${skillId} ${currentInput}`
    composerStore.setInput(nextInput)
    composerStore.setCursorIndex(nextInput.length)
  }

  function handleStartWaggle(config: WaggleConfig): void {
    setWaggleConfig(config)
  }

  function handleStopCollaboration(): void {
    if (activeConversationId) {
      api.cancelWaggle(activeConversationId)
    }
    stopWaggleCollaboration()
  }

  async function handleSteer(messageId: string): Promise<void> {
    if (!activeConversationId) return
    const queue = useMessageQueueStore.getState().queues.get(activeConversationId)
    const item = queue?.find((i) => i.id === messageId)
    if (!item) return
    setIsSteering(true)
    useMessageQueueStore.getState().dismiss(activeConversationId, messageId)
    try {
      await steer()
      await handleSendWithWaggle(item.payload)
    } catch {
      // Re-enqueue on failure so the message isn't silently lost
      useMessageQueueStore.getState().enqueue(activeConversationId, item.payload)
    } finally {
      setIsSteering(false)
    }
  }

  async function handleSendWithWaggle(payload: AgentSendPayload): Promise<void> {
    if (waggleConfig && waggleStatus === 'idle') {
      if (activeConversationId) {
        startWaggleCollaboration(activeConversationId, waggleConfig)
      }
      await handleSendWaggle(payload, waggleConfig)
      return
    }

    await handleSend(payload)
  }

  return {
    transcript: {
      messages,
      isLoading: isLoading || isSteering,
      projectPath,
      recentProjects,
      activeConversationId,
      virtualRows,
      onOpenProject: handleOpenProject,
      onSelectProjectPath: handleSelectProjectPath,
      onRetryText: handleSendText,
      onAnswerQuestion: answerQuestion,
      onRespondToPlan: respondToPlan,
      onOpenSettings: openSettings,
      onDismissError: setDismissedError,
    },
    composer: {
      pendingApproval,
      pendingAskUser,
      activeConversationId,
      waggleStatus,
      commandPaletteOpen,
      slashSkills: catalog?.skills ?? [],
      isLoading: isLoading || isSteering,
      status,
      onToolApprovalResponse: respondToolApproval,
      onAnswerQuestion: answerQuestion,
      onStopCollaboration: handleStopCollaboration,
      onSelectSkill: handleSelectSkill,
      onStartWaggle: handleStartWaggle,
      onSendWithWaggle: handleSendWithWaggle,
      onSteer: handleSteer,
      onCancel: stop,
      onToast: showToast,
    },
    diff: {
      projectPath,
      onSendMessage: handleSendText,
    },
  }
}
