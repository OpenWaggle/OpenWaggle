import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createSkillMentionNode } from '@/components/composer/nodes/SkillMentionNode'
import type { AgentChatStatus, AgentCompactionStatus } from '@/hooks/useAgentChat'
import type { useStreamingPhase } from '@/hooks/useStreamingPhase'
import { useComposerStore } from '@/stores/composer-store'
import type { SessionForkTarget } from '../session-fork-targets'
import type { ChatComposerSectionState } from '../use-chat-panel-controller'

export interface ComposerSectionParams {
  readonly isLoading: boolean
  readonly isSteering: boolean
  readonly status: AgentChatStatus
  readonly compactionStatus: AgentCompactionStatus | null
  readonly activeSessionId: SessionId | null
  readonly waggleStatus: WaggleCollaborationStatus
  readonly commandPaletteOpen: boolean
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly forkSelectorOpen: boolean
  readonly forkTargets: readonly SessionForkTarget[]
  readonly phase: ReturnType<typeof useStreamingPhase>
  readonly stop: () => void
  readonly showToast: (message: string) => void
  readonly handleSteer: (messageId: string) => Promise<void>
  readonly handleSendWithWaggle: (payload: AgentSendPayload) => Promise<void>
  readonly handleStartWaggle: (config: WaggleConfig) => void
  readonly handleStopCollaboration: () => void
  readonly handleSkipBranchSummary: () => void
  readonly handleSummarizeBranch: () => void
  readonly handleStartCustomBranchSummary: () => void
  readonly handleCancelBranchSummary: () => void
  readonly handleOpenForkSelector: () => void
  readonly handleCloseForkSelector: () => void
  readonly handleSelectForkTarget: (target: SessionForkTarget) => void
  readonly handleCloneToNewSession: () => void
}

export function useComposerSection(params: ComposerSectionParams): ChatComposerSectionState {
  const {
    isLoading,
    isSteering,
    status,
    compactionStatus,
    activeSessionId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
    forkSelectorOpen,
    forkTargets,
    phase,
    stop,
    showToast,
    handleSteer,
    handleSendWithWaggle,
    handleStartWaggle,
    handleStopCollaboration,
    handleSkipBranchSummary,
    handleSummarizeBranch,
    handleStartCustomBranchSummary,
    handleCancelBranchSummary,
    handleOpenForkSelector,
    handleCloseForkSelector,
    handleSelectForkTarget,
    handleCloneToNewSession,
  } = params

  function handleSelectSkill(skillId: string, skillName?: string): void {
    const composerStore = useComposerStore.getState()
    const editor = composerStore.lexicalEditor

    if (editor) {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const mentionNode = $createSkillMentionNode(skillId, skillName ?? skillId)
        paragraph.append(mentionNode)
        paragraph.append($createTextNode(' '))
        root.append(paragraph)
        root.selectEnd()
      })
      editor.focus()
    } else {
      // Fallback: plain text (no Lexical editor available)
      const currentInput = composerStore.input
      const nextInput = currentInput === '/' ? `/${skillId} ` : `/${skillId} ${currentInput}`
      composerStore.setInput(nextInput)
      composerStore.setCursorIndex(nextInput.length)
    }
  }

  return {
    activeSessionId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
    forkSelectorOpen,
    forkTargets,
    isLoading: isLoading || isSteering || phase.current !== null,
    status,
    compactionStatus,
    onStopCollaboration: handleStopCollaboration,
    onSelectSkill: handleSelectSkill,
    onStartWaggle: handleStartWaggle,
    onSendWithWaggle: handleSendWithWaggle,
    onSteer: handleSteer,
    onCancel: stop,
    onToast: showToast,
    onSkipBranchSummary: handleSkipBranchSummary,
    onSummarizeBranch: handleSummarizeBranch,
    onStartCustomBranchSummary: handleStartCustomBranchSummary,
    onCancelBranchSummary: handleCancelBranchSummary,
    onOpenForkSelector: handleOpenForkSelector,
    onCloseForkSelector: handleCloseForkSelector,
    onSelectForkTarget: handleSelectForkTarget,
    onCloneToNewSession: handleCloneToNewSession,
  }
}
