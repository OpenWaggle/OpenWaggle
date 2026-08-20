import type { AgentSendPayload } from '@shared/types/agent'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WaggleCollaborationStatus } from '@shared/types/waggle'
import type { AgentChatStatus, AgentCompactionStatus } from '@/features/chat/hooks/useAgentChat'
import type { useStreamingPhase } from '@/features/chat/hooks/useStreamingPhase'
import {
  insertSkillReferenceAtActiveSlash,
  insertWagglePresetAtActiveSlash,
} from '@/features/composer/lib'
import type { SessionForkTarget } from '../lib/session-fork-targets'
import type { ChatComposerSectionState } from '../model'

export interface ComposerSectionParams {
  readonly isLoading: boolean
  readonly isSteering: boolean
  readonly status: AgentChatStatus
  readonly compactionStatus: AgentCompactionStatus | null
  readonly activeSessionId: SessionId | null
  readonly session: SessionDetail | null
  readonly isFirstMessage: boolean
  readonly waggleStatus: WaggleCollaborationStatus
  readonly slashCommandMenuOpen: boolean
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly forkSelectorOpen: boolean
  readonly forkTargets: readonly SessionForkTarget[]
  readonly phase: ReturnType<typeof useStreamingPhase>
  readonly stop: () => void
  readonly showToast: (message: string) => void
  readonly handleSteer: (messageId: string) => Promise<void>
  readonly handleSendWithWaggle: (payload: AgentSendPayload) => Promise<void>
  readonly handleStopCollaboration: () => void
  readonly handleSkipBranchSummary: () => void
  readonly handleSummarizeBranch: () => void
  readonly handleStartCustomBranchSummary: () => void
  readonly handleCancelBranchSummary: () => void
  readonly handleOpenForkSelector: () => void
  readonly handleCloseForkSelector: () => void
  readonly handleSelectForkTarget: (target: SessionForkTarget) => void
  readonly handleCloneToNewSession: () => void
  readonly handleSetAuthorizationMode: (authorizationMode: AgentAuthorizationMode) => Promise<void>
}

/** Closes over nothing but the composer store singleton — hoisted to module scope. */
function handleSelectSkill(skillId: string, skillName?: string) {
  insertSkillReferenceAtActiveSlash(skillId, skillName ?? skillId)
}

export function useComposerSection(params: ComposerSectionParams): ChatComposerSectionState {
  const {
    isLoading,
    isSteering,
    status,
    compactionStatus,
    activeSessionId,
    waggleStatus,
    slashCommandMenuOpen,
    slashSkills,
    forkSelectorOpen,
    forkTargets,
    phase,
    stop,
    showToast,
    handleSteer,
    handleSendWithWaggle,
    handleStopCollaboration,
    handleSkipBranchSummary,
    handleSummarizeBranch,
    handleStartCustomBranchSummary,
    handleCancelBranchSummary,
    handleOpenForkSelector,
    handleCloseForkSelector,
    handleSelectForkTarget,
    handleCloneToNewSession,
    handleSetAuthorizationMode,
  } = params

  const isFirstMessage = params.isFirstMessage

  return {
    activeSessionId,
    session: params.session,
    isFirstMessage,
    waggleStatus,
    slashCommandMenuOpen,
    slashSkills,
    forkSelectorOpen,
    forkTargets,
    isLoading: isLoading || isSteering || phase.current !== null,
    status,
    compactionStatus,
    onStopCollaboration: handleStopCollaboration,
    onSelectSkill: handleSelectSkill,
    onStartWaggle: insertWagglePresetAtActiveSlash,
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
    onSetAuthorizationMode: handleSetAuthorizationMode,
  }
}
