import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical'
import { $createSkillMentionNode } from '@/components/composer/nodes/SkillMentionNode'
import type { AgentChatStatus, AgentCompactionStatus } from '@/hooks/useAgentChat'
import type { useStreamingPhase } from '@/hooks/useStreamingPhase'
import { useComposerStore } from '@/stores/composer-store'
import type { ChatComposerSectionState } from '../use-chat-panel-controller'

export interface ComposerSectionParams {
  readonly isLoading: boolean
  readonly isSteering: boolean
  readonly status: AgentChatStatus
  readonly compactionStatus: AgentCompactionStatus | null
  readonly activeConversationId: ConversationId | null
  readonly waggleStatus: WaggleCollaborationStatus
  readonly commandPaletteOpen: boolean
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly phase: ReturnType<typeof useStreamingPhase>
  readonly stop: () => void
  readonly showToast: (message: string) => void
  readonly handleSteer: (messageId: string) => Promise<void>
  readonly handleSendWithWaggle: (payload: AgentSendPayload) => Promise<void>
  readonly handleStartWaggle: (config: WaggleConfig) => void
  readonly handleStopCollaboration: () => void
}

export function useComposerSection(params: ComposerSectionParams): ChatComposerSectionState {
  const {
    isLoading,
    isSteering,
    status,
    compactionStatus,
    activeConversationId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
    phase,
    stop,
    showToast,
    handleSteer,
    handleSendWithWaggle,
    handleStartWaggle,
    handleStopCollaboration,
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
    activeConversationId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
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
  }
}
