import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionInterruptedRun } from '@shared/types/session'
import type { WaggleMessageMetadata } from '@shared/types/waggle'
import type { useStreamingPhase } from '@/features/chat/hooks/useStreamingPhase'
import type { ChatRow } from '../lib/types-chat-row'
import type { AgentCompactionStatus } from './useAgentChat.types'
import { buildChatRows } from './useBuildChatRows'

export function useChatRows(inputs: {
  messages: UIMessage[]
  customMessages?: Parameters<typeof buildChatRows>[0]['customMessages']
  interactionEvents?: Parameters<typeof buildChatRows>[0]['interactionEvents']
  agentLoopAnchorMessageIds: ReadonlyMap<string, string> | undefined
  isLoading: boolean
  isFinishing?: boolean
  error: Error | undefined
  lastUserMessage: string | null
  dismissedError: string | null
  sessionId: SessionId | null
  model: SupportedModelId | undefined
  waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
  phase: ReturnType<typeof useStreamingPhase>
  interruptedRun: SessionInterruptedRun | undefined
  worktreeLaunch?: WorktreeLaunchSnapshot | null
  firstSendPending?: boolean
  compactionStatus?: AgentCompactionStatus | null
  turnDurationsByAnchorMessageId: ReadonlyMap<string, number> | undefined
  expandedTurnKeys?: ReadonlySet<string>
  extensionStatus?: Parameters<typeof buildChatRows>[0]['extensionStatus']
}): ChatRow[] {
  return buildChatRows({
    messages: inputs.messages,
    customMessages: inputs.customMessages ?? [],
    interactionEvents: inputs.interactionEvents ?? [],
    ...(inputs.agentLoopAnchorMessageIds === undefined
      ? {}
      : { agentLoopAnchorMessageIds: inputs.agentLoopAnchorMessageIds }),
    isLoading: inputs.isLoading,
    ...(inputs.isFinishing === undefined ? {} : { isFinishing: inputs.isFinishing }),
    error: inputs.error,
    lastUserMessage: inputs.lastUserMessage,
    dismissedError: inputs.dismissedError,
    sessionId: inputs.sessionId,
    waggleMetadataLookup: inputs.waggleMetadataLookup,
    phase: inputs.phase,
    ...(inputs.interruptedRun === undefined ? {} : { interruptedRun: inputs.interruptedRun }),
    ...(inputs.worktreeLaunch === undefined ? {} : { worktreeLaunch: inputs.worktreeLaunch }),
    ...(inputs.firstSendPending === undefined ? {} : { firstSendPending: inputs.firstSendPending }),
    ...(inputs.compactionStatus === undefined ? {} : { compactionStatus: inputs.compactionStatus }),
    ...(inputs.turnDurationsByAnchorMessageId === undefined
      ? {}
      : { turnDurationsByAnchorMessageId: inputs.turnDurationsByAnchorMessageId }),
    ...(inputs.expandedTurnKeys === undefined ? {} : { expandedTurnKeys: inputs.expandedTurnKeys }),
    ...(inputs.extensionStatus === undefined ? {} : { extensionStatus: inputs.extensionStatus }),
  })
}
