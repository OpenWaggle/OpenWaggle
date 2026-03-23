import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import { isTrustableToolName } from '@shared/types/tool-approval'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import type { useAgentChat } from '@/hooks/useAgentChat'
import type { useStreamingPhase } from '@/hooks/useStreamingPhase'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { useComposerStore } from '@/stores/composer-store'
import type { ApprovalResponseAction, PendingApproval } from '../pending-tool-interactions'
import { findPendingAskUser } from '../pending-tool-interactions'
import type { ChatComposerSectionState } from '../use-chat-panel-controller'
import { usePendingApprovalTrustCheck } from './usePendingApprovalTrustCheck'

const logger = createRendererLogger('chat-composer')

export interface ComposerSectionParams {
  readonly messages: UIMessage[]
  readonly isLoading: boolean
  readonly isSteering: boolean
  readonly status: 'ready' | 'submitted' | 'streaming' | 'error'
  readonly activeConversationId: ConversationId | null
  readonly trustProjectPath: string | null
  readonly executionMode: string
  readonly waggleStatus: WaggleCollaborationStatus
  readonly commandPaletteOpen: boolean
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly phase: ReturnType<typeof useStreamingPhase>
  readonly activeConversation: Parameters<typeof usePendingApprovalTrustCheck>[1]
  readonly respondToolApproval: ReturnType<typeof useAgentChat>['respondToolApproval']
  readonly answerQuestion: ReturnType<typeof useAgentChat>['answerQuestion']
  readonly stop: () => void
  readonly showToast: (message: string) => void
  readonly handleSteer: (messageId: string) => Promise<void>
  readonly handleSendWithWaggle: (payload: AgentSendPayload) => Promise<void>
  readonly handleStartWaggle: (config: WaggleConfig) => void
  readonly handleStopCollaboration: () => void
}

export function useComposerSection(params: ComposerSectionParams): ChatComposerSectionState {
  const {
    messages,
    isLoading,
    isSteering,
    status,
    activeConversationId,
    trustProjectPath,
    executionMode,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
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
  } = params

  const { pendingApprovalForUI } = usePendingApprovalTrustCheck(
    messages,
    activeConversation,
    executionMode,
    trustProjectPath,
    respondToolApproval,
  )
  const pendingAskUser = findPendingAskUser(messages)

  function handleSelectSkill(skillId: string): void {
    const composerStore = useComposerStore.getState()
    const currentInput = composerStore.input
    const nextInput = currentInput === '/' ? `/${skillId} ` : `/${skillId} ${currentInput}`
    composerStore.setInput(nextInput)
    composerStore.setCursorIndex(nextInput.length)
  }

  async function handleToolApprovalResponse(
    currentPendingApproval: PendingApproval,
    response: ApprovalResponseAction,
  ): Promise<void> {
    const approved = response.kind !== 'deny'
    await respondToolApproval(currentPendingApproval.approvalId, approved)

    if (response.kind !== 'approve-and-trust') {
      return
    }
    if (executionMode !== 'default-permissions') {
      return
    }
    if (!trustProjectPath) {
      return
    }
    if (!isTrustableToolName(currentPendingApproval.toolName)) {
      return
    }
    if (typeof api.recordProjectToolApproval !== 'function') {
      return
    }

    try {
      await api.recordProjectToolApproval(
        trustProjectPath,
        currentPendingApproval.toolName,
        currentPendingApproval.toolArgs,
      )
    } catch (error) {
      logger.warn('Failed to persist tool approval trust', {
        toolName: currentPendingApproval.toolName,
        toolCallId: currentPendingApproval.toolCallId,
        error: error instanceof Error ? error.message : String(error),
      })
      showToast('Approved. Could not save trust rule; approval may be requested again.')
    }
  }

  return {
    pendingApproval: pendingApprovalForUI,
    pendingAskUser,
    activeConversationId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
    isLoading: isLoading || isSteering || phase.current !== null,
    status,
    onToolApprovalResponse: handleToolApprovalResponse,
    onAnswerQuestion: answerQuestion,
    onStopCollaboration: handleStopCollaboration,
    onSelectSkill: handleSelectSkill,
    onStartWaggle: handleStartWaggle,
    onSendWithWaggle: handleSendWithWaggle,
    onSteer: handleSteer,
    onCancel: stop,
    onToast: showToast,
  }
}
