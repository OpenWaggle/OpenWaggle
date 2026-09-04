import type { SessionBranchId, SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportCustomEvent } from '@shared/types/stream'
import type { WaggleCollaborationStatus } from '@shared/types/waggle'
import { useState } from 'react'
import type { useStreamingPhase } from '@/features/chat/hooks/useStreamingPhase'
import { useWaggleMetadataLookup } from '@/features/chat/hooks/useWaggleMetadataLookup'
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store'
import { useSessionStore } from '@/features/sessions/state'
import {
  mergeCustomMessages,
  mergeInteractionEvents,
  readAgentLoopEventsFromWorkspace,
} from '../lib/agent-loop-transcript-events'
import { resolveTranscriptMessages } from '../lib/session-workspace-transcript'
import type { AgentInteractionEvent } from '../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../model'
import { useChatRows } from './useChatRows'

function resolveLastUserMessage(messages: UIMessage[]) {
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

  const textParts: string[] = []
  for (const part of lastUserMessage.parts) {
    if (part.type === 'text') textParts.push(part.content)
  }
  const content = textParts.join('\n')

  return content || null
}

export interface TranscriptSectionParams {
  readonly messages: UIMessage[]
  readonly customMessages: readonly AgentTransportCustomEvent[]
  readonly interactionEvents: readonly AgentInteractionEvent[]
  readonly isLoading: boolean
  readonly isSteering: boolean
  readonly error: Error | undefined
  readonly streamSignalVersion: number
  readonly projectPath: string | null
  readonly recentProjects: readonly string[]
  readonly activeSessionId: SessionId | null
  readonly activeSession: SessionDetail | null
  readonly model: SupportedModelId
  readonly waggleStatus: WaggleCollaborationStatus
  readonly phase: ReturnType<typeof useStreamingPhase>
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
  readonly handleOpenProject: () => Promise<void>
  readonly handleSelectProjectPath: (path: string) => void
  readonly handleSendText: (content: string) => Promise<void>
  readonly openSettings: () => void
  readonly handleDismissInterruptedRun: (runId: string, branchId: SessionBranchId) => void
  readonly handleBranchFromMessage: (messageId: string) => void
  readonly handleForkFromMessage: (messageId: string) => void
  readonly handleViewTurnDiff: (messageId: string) => void
  readonly turnAnchorMessageIds: ReadonlySet<string>
  readonly userDidSend: boolean
  readonly onUserDidSendConsumed: () => void
}

export function useTranscriptSection(params: TranscriptSectionParams): ChatTranscriptSectionState {
  const {
    messages,
    customMessages,
    interactionEvents,
    isLoading,
    isSteering,
    error,
    streamSignalVersion,
    projectPath,
    recentProjects,
    activeSessionId,
    activeSession,
    model,
    phase,
    extensionRegistry,
    extensionProjectPaths,
    handleOpenProject,
    handleSelectProjectPath,
    handleSendText,
    openSettings,
    handleDismissInterruptedRun,
    handleBranchFromMessage,
    handleForkFromMessage,
    userDidSend,
    onUserDidSendConsumed,
  } = params

  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const worktreeLaunch = useBackgroundRunStore((state) =>
    activeSessionId ? (state.worktreeLaunchBySessionId.get(activeSessionId) ?? null) : null,
  )
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const draftBranchSourceNodeId =
    activeSessionId &&
    draftBranch?.sessionId &&
    String(draftBranch.sessionId) === String(activeSessionId)
      ? draftBranch.sourceNodeId
      : null

  const transcriptLoading = isLoading || isSteering
  const transcriptMessages = resolveTranscriptMessages({
    activeSessionId,
    activeSessionUpdatedAt: activeSession?.updatedAt,
    activeWorkspace,
    messages,
    draftBranchSourceNodeId,
  })
  const persistedAgentLoopEvents = activeWorkspace
    ? readAgentLoopEventsFromWorkspace(activeWorkspace)
    : { customMessages: [], interactionEvents: [] }
  const mergedCustomMessages = mergeCustomMessages(
    persistedAgentLoopEvents.customMessages,
    customMessages,
  )
  const mergedInteractionEvents = mergeInteractionEvents(
    persistedAgentLoopEvents.interactionEvents,
    interactionEvents,
  )
  const waggleMetadataLookup = useWaggleMetadataLookup(activeSession, transcriptMessages)

  const lastUserMessage = resolveLastUserMessage(transcriptMessages)
  const interruptedRun =
    activeWorkspace?.tree.session.id === activeSessionId
      ? activeWorkspace.tree.branches.find((branch) => branch.id === activeWorkspace.activeBranchId)
          ?.interruptedRun
      : undefined

  const chatRows = useChatRows({
    messages: transcriptMessages,
    customMessages: mergedCustomMessages,
    interactionEvents: mergedInteractionEvents,
    isLoading: transcriptLoading,
    error,
    lastUserMessage,
    dismissedError,
    sessionId: activeSessionId,
    model,
    waggleMetadataLookup,
    phase,
    interruptedRun,
    worktreeLaunch,
  })

  // Compute lastUserMessageId for session-restore identity gating, not send anchoring.
  const lastUserMessageId = (() => {
    for (let i = transcriptMessages.length - 1; i >= 0; i -= 1) {
      if (transcriptMessages[i]?.role === 'user') return transcriptMessages[i]?.id ?? null
    }
    return null
  })()

  return {
    messages: transcriptMessages,
    isLoading: transcriptLoading,
    projectPath,
    worktreePath: activeSession?.worktreePath ?? null,
    recentProjects,
    activeSessionId,
    chatRows,
    extensionRegistry,
    extensionProjectPaths,
    onOpenProject: handleOpenProject,
    onSelectProjectPath: handleSelectProjectPath,
    onRetryText: handleSendText,
    onOpenSettings: openSettings,
    onDismissError: setDismissedError,
    onDismissInterruptedRun: handleDismissInterruptedRun,
    onBranchFromMessage: handleBranchFromMessage,
    onForkFromMessage: handleForkFromMessage,
    onViewTurnDiff: params.handleViewTurnDiff,
    turnAnchorMessageIds: params.turnAnchorMessageIds,
    lastUserMessageId,
    streamSignalVersion,
    userDidSend,
    onUserDidSendConsumed,
  }
}
