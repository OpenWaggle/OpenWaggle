import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useState } from 'react'
import { useAgentChat } from '@/hooks/useAgentChat'
import { useAgentPhase } from '@/hooks/useAgentPhase'
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
  onToolApprovalResponse: ReturnType<typeof useAgentChat>['respondToolApproval']
  onAnswerQuestion: ReturnType<typeof useAgentChat>['answerQuestion']
  onStopCollaboration: () => void
  onSelectSkill: (skillId: string) => void
  onStartWaggle: (config: WaggleConfig) => void
  onSendWithWaggle: (payload: AgentSendPayload) => Promise<void>
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
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
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
    stop,
    error,
    respondToolApproval,
    answerQuestion,
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

  const lastUserMessage = resolveLastUserMessage(messages)

  const virtualRows = buildVirtualRows({
    messages,
    isLoading,
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
      isLoading,
      projectPath,
      recentProjects,
      activeConversationId,
      virtualRows,
      onOpenProject: handleOpenProject,
      onSelectProjectPath: handleSelectProjectPath,
      onRetryText: handleSendText,
      onAnswerQuestion: answerQuestion,
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
      isLoading,
      onToolApprovalResponse: respondToolApproval,
      onAnswerQuestion: answerQuestion,
      onStopCollaboration: handleStopCollaboration,
      onSelectSkill: handleSelectSkill,
      onStartWaggle: handleStartWaggle,
      onSendWithWaggle: handleSendWithWaggle,
      onCancel: stop,
      onToast: showToast,
    },
    diff: {
      projectPath,
      onSendMessage: handleSendText,
    },
  }
}
