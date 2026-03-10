import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import { isTrustableToolName } from '@shared/types/tool-approval'
import type {
  WaggleCollaborationStatus,
  WaggleConfig,
  WaggleMessageMetadata,
} from '@shared/types/waggle'
import type { UIMessage } from '@tanstack/ai-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgentChat } from '@/hooks/useAgentChat'
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
import { createRendererLogger } from '@/lib/logger'
import { useComposerStore } from '@/stores/composer-store'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useUIStore } from '@/stores/ui-store'
import { useWaggleStore } from '@/stores/waggle-store'
import {
  type ApprovalTrustStatus,
  resolvePendingApprovalForUI,
} from './pending-approval-visibility'
import {
  findPendingApproval,
  findPendingAskUser,
  type PendingApproval,
  type PendingAskUser,
} from './pending-tool-interactions'
import { reportAutoSendQueueFailure, reportQueuedSteerFailure } from './queue-failure-feedback'
import type { VirtualRow } from './types-virtual'
import { buildVirtualRows } from './useVirtualRows'

const logger = createRendererLogger('chat-panel')

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
  onToolApprovalResponse: (pendingApproval: PendingApproval, approved: boolean) => Promise<void>
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

function getApprovalTrustStatusKey(pendingApproval: PendingApproval): string {
  return `${pendingApproval.approvalId}:${pendingApproval.toolCallId}`
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

function getCurrentTurnMessages(messages: UIMessage[]): UIMessage[] {
  let lastUserIndex = -1

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'user') {
      lastUserIndex = index
      break
    }
  }

  return messages.slice(lastUserIndex + 1)
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

  const messageModelLookup = useMessageModelLookup(activeConversation)
  const waggleMetadataLookup = useWaggleMetadataLookup(activeConversation, messages)
  useWaggleChat(activeConversationId)
  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const activeConversationRef = useRef(activeConversation)
  activeConversationRef.current = activeConversation

  const phase = useStreamingPhase(activeConversationId)

  const { catalog } = useSkills(projectPath)

  const waggleStatus = useWaggleStore((s) => s.status)
  const waggleConfig = useWaggleStore((s) => s.activeConfig)
  const setWaggleConfig = useWaggleStore((s) => s.setConfig)
  const startWaggleCollaboration = useWaggleStore((s) => s.startCollaboration)
  const stopWaggleCollaboration = useWaggleStore((s) => s.stopCollaboration)

  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [isSteering, setIsSteering] = useState(false)
  // Cache trust outcomes per approval/tool-call so thread switches do not
  // temporarily hide an already-untrusted approval while trust is re-checked.
  const approvalTrustStatusRef = useRef<Record<string, ApprovalTrustStatus>>({})
  const [approvalTrustStatusById, setApprovalTrustStatusById] = useState<
    Record<string, ApprovalTrustStatus>
  >({})

  const setApprovalTrustStatus = useCallback(
    (approvalTrustKey: string, status: ApprovalTrustStatus): void => {
      const nextStatus = {
        ...approvalTrustStatusRef.current,
        [approvalTrustKey]: status,
      } satisfies Record<string, ApprovalTrustStatus>
      approvalTrustStatusRef.current = nextStatus
      setApprovalTrustStatusById(nextStatus)
    },
    [],
  )

  useAutoSendQueue({
    conversationId: activeConversationId,
    status,
    sendMessage: handleSend,
    paused: isSteering,
    onSendFailure: (payload, sendError) => {
      reportAutoSendQueueFailure({ logger, showToast }, activeConversationId, payload, sendError)
    },
  })

  const lastUserMessage = resolveLastUserMessage(messages)
  const transcriptLoading = isLoading || isSteering
  const virtualRowsCacheRef = useRef<{
    messages: UIMessage[]
    isLoading: boolean
    error: Error | undefined
    lastUserMessage: string | null
    dismissedError: string | null
    conversationId: ConversationId | null
    model: SupportedModelId
    messageModelLookup: Readonly<Record<string, SupportedModelId>>
    waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>
    phase: ReturnType<typeof useStreamingPhase>
    rows: VirtualRow[]
  } | null>(null)

  const virtualRows =
    virtualRowsCacheRef.current?.messages === messages &&
    virtualRowsCacheRef.current.isLoading === transcriptLoading &&
    virtualRowsCacheRef.current.error === error &&
    virtualRowsCacheRef.current.lastUserMessage === lastUserMessage &&
    virtualRowsCacheRef.current.dismissedError === dismissedError &&
    virtualRowsCacheRef.current.conversationId === activeConversationId &&
    virtualRowsCacheRef.current.model === model &&
    virtualRowsCacheRef.current.messageModelLookup === messageModelLookup &&
    virtualRowsCacheRef.current.waggleMetadataLookup === waggleMetadataLookup &&
    virtualRowsCacheRef.current.phase === phase
      ? virtualRowsCacheRef.current.rows
      : (() => {
          const rows = buildVirtualRows({
            messages,
            isLoading: transcriptLoading,
            error,
            lastUserMessage,
            dismissedError,
            conversationId: activeConversationId,
            model,
            messageModelLookup,
            waggleMetadataLookup,
            phase,
          })
          virtualRowsCacheRef.current = {
            messages,
            isLoading: transcriptLoading,
            error,
            lastUserMessage,
            dismissedError,
            conversationId: activeConversationId,
            model,
            messageModelLookup,
            waggleMetadataLookup,
            phase,
            rows,
          }
          return rows
        })()

  const pendingApproval = findPendingApproval(messages, activeConversation)
  const pendingAskUser = findPendingAskUser(messages)
  const pendingApprovalTrustableToolName =
    pendingApproval && isTrustableToolName(pendingApproval.toolName)
      ? pendingApproval.toolName
      : null
  const pendingApprovalHasApprovalMetadata = pendingApproval?.hasApprovalMetadata === true
  const trustProjectPath = activeConversation?.projectPath ?? projectPath
  const pendingApprovalTrustKey = pendingApproval
    ? getApprovalTrustStatusKey(pendingApproval)
    : null
  const canCheckPendingApprovalTrust = Boolean(
    pendingApproval &&
      executionMode === 'default-permissions' &&
      trustProjectPath &&
      pendingApprovalTrustableToolName &&
      typeof api.isProjectToolCallTrusted === 'function',
  )
  const canAutoApprovePendingTool =
    canCheckPendingApprovalTrust && pendingApprovalHasApprovalMetadata
  const pendingApprovalTrustStatus = pendingApprovalTrustKey
    ? approvalTrustStatusById[pendingApprovalTrustKey]
    : undefined
  const pendingApprovalForUI = resolvePendingApprovalForUI({
    pendingApproval,
    canCheckPendingApprovalTrust,
    pendingApprovalTrustStatus,
  })

  // Use stable primitive key to avoid re-firing the effect when
  // findPendingApproval returns a new object reference for the same
  // logical approval (which happens on every messages change).
  const pendingApprovalKey = pendingApprovalTrustKey
  const pendingApprovalArgs = pendingApproval?.toolArgs
  const pendingApprovalId = pendingApproval?.approvalId

  // Keep a ref to the current trust status so the auto-approve effect can
  // read it as a guard without depending on it. Including it as a dep would
  // cause the effect to re-fire (and cancel the in-flight trust check via the
  // cleanup function) as soon as the status moves from undefined → 'checking'.
  const pendingApprovalTrustStatusRef = useRef(pendingApprovalTrustStatus)
  pendingApprovalTrustStatusRef.current = pendingApprovalTrustStatus

  // Detect duplicate tool calls — the model may re-propose an already-executed
  // tool after a continuation re-execution (TanStack AI known issue #1).
  // Computed as a ref so the auto-approve effect can read it without a dep.
  const pendingApprovalIsDuplicateRef = useRef(false)
  pendingApprovalIsDuplicateRef.current = (() => {
    if (!pendingApproval) return false
    const currentTurnMessages = getCurrentTurnMessages(messages)

    for (const msg of currentTurnMessages) {
      for (const part of msg.parts) {
        if (
          part.type === 'tool-call' &&
          part.name === pendingApproval.toolName &&
          part.arguments === pendingApproval.toolArgs &&
          part.id !== pendingApproval.toolCallId
        ) {
          const hasResult = currentTurnMessages.some((m) =>
            m.parts.some((p) => p.type === 'tool-result' && p.toolCallId === part.id),
          )
          if (hasResult) return true
        }
      }
    }
    return false
  })()

  const isPendingApprovalStillCurrent = useCallback((approvalTrustKey: string): boolean => {
    const currentPendingApproval = findPendingApproval(
      messagesRef.current,
      activeConversationRef.current,
    )
    if (!currentPendingApproval) {
      return false
    }
    return getApprovalTrustStatusKey(currentPendingApproval) === approvalTrustKey
  }, [])

  useEffect(() => {
    if (
      !pendingApprovalKey ||
      !pendingApprovalId ||
      !canAutoApprovePendingTool ||
      !trustProjectPath ||
      !pendingApprovalTrustableToolName
    ) {
      return
    }
    // Read from ref so this check doesn't create a dependency.
    if (pendingApprovalTrustStatusRef.current !== undefined) {
      return
    }

    let active = true

    // Auto-approve duplicate tool calls that were re-proposed by the model
    // after a continuation re-execution (TanStack AI known issue #1).
    // Skip the duplicate instead of executing the same side-effect again.
    if (pendingApprovalIsDuplicateRef.current) {
      void (async () => {
        if (!isPendingApprovalStillCurrent(pendingApprovalKey)) {
          return
        }
        setApprovalTrustStatus(pendingApprovalKey, 'checking')
        try {
          await respondToolApproval(pendingApprovalId, false)
        } catch (err) {
          if (!active) return
          setApprovalTrustStatus(pendingApprovalKey, 'untrusted')
          logger.error('[AUTO-APPROVE] Error auto-skipping duplicate tool call', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })()
      return () => {
        active = false
      }
    }

    setApprovalTrustStatus(pendingApprovalKey, 'checking')

    void (async () => {
      try {
        const trusted = await api.isProjectToolCallTrusted(
          trustProjectPath,
          pendingApprovalTrustableToolName,
          pendingApprovalArgs ?? '',
        )
        if (!active || !isPendingApprovalStillCurrent(pendingApprovalKey)) return
        setApprovalTrustStatus(pendingApprovalKey, trusted ? 'trusted' : 'untrusted')
        if (trusted) {
          await respondToolApproval(pendingApprovalId, true)
        }
      } catch (err) {
        logger.error('[AUTO-APPROVE] Error in trust check or approval', {
          error: err instanceof Error ? err.message : String(err),
        })
        if (!active || !isPendingApprovalStillCurrent(pendingApprovalKey)) return
        setApprovalTrustStatus(pendingApprovalKey, 'untrusted')
      }
    })()

    return () => {
      active = false
    }
  }, [
    canAutoApprovePendingTool,
    pendingApprovalKey,
    pendingApprovalId,
    pendingApprovalArgs,
    pendingApprovalTrustableToolName,
    trustProjectPath,
    respondToolApproval,
    setApprovalTrustStatus,
    isPendingApprovalStillCurrent,
  ])

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
    const clearOptimisticSteeredTurn = previewSteeredUserTurn(item.payload)
    try {
      await withDeferredSnapshotRefresh(async () => {
        await steer()
        await handleSendWithWaggle(item.payload)
      })
    } catch (error) {
      clearOptimisticSteeredTurn()
      // Re-enqueue on failure so the message isn't silently lost
      useMessageQueueStore.getState().enqueue(activeConversationId, item.payload)
      reportQueuedSteerFailure({ logger, showToast }, activeConversationId, messageId, error)
    } finally {
      setIsSteering(false)
    }
  }

  async function handleSendWithWaggle(payload: AgentSendPayload): Promise<void> {
    // Reset phase tracking for the new user interaction so the RunSummary
    // accumulates phases across all continuation runs (tool approval loops)
    // instead of resetting on each continuation.
    phase.reset()

    if (waggleConfig && waggleStatus === 'idle') {
      if (activeConversationId) {
        startWaggleCollaboration(activeConversationId, waggleConfig)
      }
      await handleSendWaggle(payload, waggleConfig)
      return
    }

    await handleSend(payload)
  }

  async function handleToolApprovalResponse(
    currentPendingApproval: PendingApproval,
    approved: boolean,
  ): Promise<void> {
    await respondToolApproval(currentPendingApproval.approvalId, approved)

    if (!approved) {
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
      // Trust persistence is best effort; approval response already succeeded.
      logger.warn('Failed to persist tool approval trust', {
        toolName: currentPendingApproval.toolName,
        toolCallId: currentPendingApproval.toolCallId,
        error: error instanceof Error ? error.message : String(error),
      })
      showToast('Approved. Could not save trust rule; approval may be requested again.')
    }
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
      pendingApproval: pendingApprovalForUI,
      pendingAskUser,
      activeConversationId,
      waggleStatus,
      commandPaletteOpen,
      slashSkills: catalog?.skills ?? [],
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
    },
    diff: {
      projectPath,
      onSendMessage: handleSendText,
    },
  }
}
