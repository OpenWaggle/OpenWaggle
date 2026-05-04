import type { AgentSendPayload } from '@shared/types/agent'
import {
  ConversationId,
  type SessionBranchId,
  SessionId,
  type SessionNodeId,
} from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WaggleCollaborationStatus, WaggleConfig } from '@shared/types/waggle'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  createBranchDraftSelection,
  shouldPromptForBranchSummary,
} from '@/components/chat/branch-from-message'
import { parseCompactCommand } from '@/components/composer/compact-command'
import { buildComposerDraftContextKey } from '@/components/composer/composer-draft-context'
import { setEditorText } from '@/components/composer/lexical-utils'
import {
  type AgentChatStatus,
  type AgentCompactionStatus,
  useAgentChat,
} from '@/hooks/useAgentChat'
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
import { type BranchSummaryPromptState, useBranchSummaryStore } from '@/stores/branch-summary-store'
import { useChatStore } from '@/stores/chat-store'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useSessionStore } from '@/stores/session-store'
import { useUIStore } from '@/stores/ui-store'
import { useWaggleStore } from '@/stores/waggle-store'
import { useComposerSection } from './hooks/useComposerSection'
import { useSteerWorkflow } from './hooks/useSteerWorkflow'
import { useTranscriptSection } from './hooks/useTranscriptSection'
import { reportAutoSendQueueFailure } from './queue-failure-feedback'
import type { ChatRow } from './types-chat-row'

const logger = createRendererLogger('chat-panel')

export interface ChatTranscriptSectionState {
  readonly messages: UIMessage[]
  readonly isLoading: boolean
  readonly projectPath: string | null
  readonly recentProjects: readonly string[]
  readonly activeConversationId: ConversationId | null
  readonly chatRows: ChatRow[]
  /** The ID of the last user message — used to identify stable session hydration for scroll restore. */
  readonly lastUserMessageId: string | null
  /** Monotonic streaming signal used by scroll-follow without rescanning the full transcript. */
  readonly streamSignalVersion: number
  /** Intent flag — true when user pressed Send, consumed by scroll hook. */
  readonly userDidSend: boolean
  /** Callback to clear userDidSend after the scroll effect processes it. */
  readonly onUserDidSendConsumed: () => void
  onOpenProject: () => Promise<void>
  onSelectProjectPath: (path: string) => void
  onRetryText: (content: string) => Promise<void>
  onOpenSettings: () => void
  onDismissError: (errorId: string | null) => void
  onBranchFromMessage: (messageId: string) => void
}

export interface ChatComposerSectionState {
  readonly activeConversationId: ConversationId | null
  readonly waggleStatus: WaggleCollaborationStatus
  readonly commandPaletteOpen: boolean
  readonly slashSkills: readonly SkillDiscoveryItem[]
  readonly isLoading: boolean
  readonly status: AgentChatStatus
  readonly compactionStatus: AgentCompactionStatus | null
  onStopCollaboration: () => void
  onSelectSkill: (skillId: string, skillName?: string) => void
  onStartWaggle: (config: WaggleConfig) => void
  onSendWithWaggle: (payload: AgentSendPayload) => Promise<void>
  onSteer: (messageId: string) => Promise<void>
  onCancel: () => void
  onToast: (message: string) => void
  onSkipBranchSummary: () => void
  onSummarizeBranch: () => void
  onStartCustomBranchSummary: () => void
  onCancelBranchSummary: () => void
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
  // ── Intent-driven scroll flag ──
  const [userDidSend, setUserDidSend] = useState(false)

  function onUserDidSendConsumed(): void {
    setUserDidSend(false)
  }

  const navigate = useNavigate()
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)
  const setActiveView = useUIStore((s) => s.setActiveView)
  const showToast = useUIStore((s) => s.showToast)

  const model = usePreferencesStore((s) => s.settings.selectedModel)
  const thinkingLevel = usePreferencesStore((s) => s.settings.thinkingLevel)
  const recentProjects = usePreferencesStore((s) => s.settings.recentProjects)

  const { projectPath, selectFolder, setProjectPath } = useProject()
  const {
    conversations,
    activeConversation,
    activeConversationId,
    createConversation,
    startDraftSession,
    setActiveConversation,
    refreshConversation,
  } = useChat()

  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()
  const activeWorkspace = useSessionStore((state) => state.activeWorkspace)
  const loadSessions = useSessionStore((state) => state.loadSessions)
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const setDraftBranch = useSessionStore((state) => state.setDraftBranch)
  const clearDraftBranchForSession = useSessionStore((state) => state.clearDraftBranchForSession)
  const {
    handleOpenProject: handleOpenProjectNavigation,
    handleSelectProjectPath: handleSelectProjectPathNavigation,
  } = useConversationNav({
    conversations,
    projectPath,
    setActiveView,
    setProjectPath,
    selectFolder,
    startDraftSession,
    setActiveConversation,
    refreshGitStatus,
    refreshGitBranches,
  })

  async function handleOpenProject(): Promise<void> {
    await handleOpenProjectNavigation()
    void navigate({ to: '/' })
  }

  async function handleSelectProjectPath(path: string): Promise<void> {
    await handleSelectProjectPathNavigation(path)
    void navigate({ to: '/' })
  }

  function openSettings(): void {
    void navigate({ to: '/settings' })
  }

  const {
    messages,
    sendMessage,
    sendWaggleMessage,
    isLoading,
    status,
    stop,
    steer,
    error,
    withDeferredSnapshotRefresh,
    previewSteeredUserTurn,
    streamSignalVersion,
    compactionStatus,
  } = useAgentChat(activeConversationId, activeConversation, model, thinkingLevel)

  const { handleSend, handleSendText, handleSendWaggle } = useSendMessage({
    activeConversationId,
    projectPath,
    thinkingLevel,
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

  function setComposerTextValue(text: string): void {
    const composer = useComposerStore.getState()
    composer.setInput(text)
    if (composer.lexicalEditor) {
      setEditorText(composer.lexicalEditor, text)
    }
  }

  function draftBranchComposerContextKey(
    sessionId: SessionId,
    sourceNodeId: SessionNodeId,
  ): string {
    return buildComposerDraftContextKey({
      projectPath: activeWorkspace?.tree.session.projectPath ?? projectPath,
      sessionId,
      draftSourceNodeId: sourceNodeId,
    })
  }

  function switchComposerToDraftBranch(input: {
    readonly sessionId: SessionId
    readonly sourceNodeId: SessionNodeId
    readonly fallbackText: string
  }): string {
    const contextKey = draftBranchComposerContextKey(input.sessionId, input.sourceNodeId)
    const appliedDraft = useComposerStore.getState().switchScopedDraftContext(contextKey, {
      input: input.fallbackText,
      attachments: [],
    })
    setComposerTextValue(appliedDraft.input)
    return appliedDraft.input
  }

  function routeToSessionSelection(
    sessionId: SessionId,
    selection: {
      readonly branchId?: SessionBranchId | null
      readonly nodeId?: SessionNodeId | null
    },
  ): void {
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(sessionId) },
      search: (previous) => ({
        ...previous,
        branch: selection.branchId ? String(selection.branchId) : undefined,
        node: selection.nodeId ? String(selection.nodeId) : undefined,
      }),
    })
  }

  function maybeOpenBranchSummaryPrompt(input: {
    readonly sessionId: SessionId
    readonly sourceNodeId: SessionNodeId
    readonly restoreSelection: {
      readonly branchId: SessionBranchId | null
      readonly nodeId: SessionNodeId | null
    }
    readonly previousComposerText: string
    readonly draftComposerText: string
  }): void {
    useBranchSummaryStore.getState().clearPrompt()

    if (!shouldPromptForBranchSummary(activeWorkspace, input.sourceNodeId)) {
      return
    }

    function openIfCurrent(): void {
      const currentState = useSessionStore.getState()
      const currentDraft = currentState.draftBranch
      const currentWorkspace = currentState.activeWorkspace
      if (
        !currentDraft ||
        currentDraft.sessionId !== input.sessionId ||
        currentDraft.sourceNodeId !== input.sourceNodeId ||
        currentWorkspace?.tree.session.id !== input.sessionId
      ) {
        return
      }
      useBranchSummaryStore.getState().openPrompt(input)
    }

    if (typeof api.getPiBranchSummarySkipPrompt !== 'function') {
      openIfCurrent()
      return
    }

    void api
      .getPiBranchSummarySkipPrompt(activeWorkspace?.tree.session.projectPath ?? projectPath)
      .then((skipPrompt) => {
        if (!skipPrompt) {
          openIfCurrent()
        }
      })
      .catch((skipPromptError: unknown) => {
        const message =
          skipPromptError instanceof Error ? skipPromptError.message : String(skipPromptError)
        logger.warn('Failed to load branch summary skip-prompt preference', { message })
        openIfCurrent()
      })
  }

  function isCurrentBranchSummaryPrompt(prompt: BranchSummaryPromptState): boolean {
    const currentPrompt = useBranchSummaryStore.getState().prompt
    const currentWorkspace = useSessionStore.getState().activeWorkspace
    const currentConversationId = useChatStore.getState().activeConversationId
    return (
      currentPrompt?.sessionId === prompt.sessionId &&
      currentPrompt.sourceNodeId === prompt.sourceNodeId &&
      currentPrompt.previousComposerText === prompt.previousComposerText &&
      currentPrompt.draftComposerText === prompt.draftComposerText &&
      currentPrompt.mode === 'summarizing' &&
      currentWorkspace?.tree.session.id === prompt.sessionId &&
      String(currentConversationId) === String(prompt.sessionId)
    )
  }

  async function materializeBranchSummary(customInstructions?: string): Promise<void> {
    const prompt = useBranchSummaryStore.getState().prompt
    if (!prompt) {
      return
    }

    const previousMode = prompt.mode
    useBranchSummaryStore.getState().startSummarizing()

    try {
      const trimmedInstructions = customInstructions?.trim()
      const navigation = await api.navigateSessionTree(
        prompt.sessionId,
        model,
        prompt.sourceNodeId,
        {
          summarize: true,
          ...(trimmedInstructions ? { customInstructions: trimmedInstructions } : {}),
        },
      )

      if (!isCurrentBranchSummaryPrompt(prompt)) {
        return
      }

      if (navigation.cancelled) {
        showToast('Branch summarization cancelled.')
        if (previousMode === 'custom') {
          useBranchSummaryStore.getState().startCustomPrompt(prompt.draftComposerText)
        } else {
          useBranchSummaryStore.getState().restoreChoice()
        }
        return
      }

      useBranchSummaryStore.getState().clearPrompt()
      clearDraftBranchForSession(prompt.sessionId)

      await Promise.all([
        loadSessions(),
        refreshConversation(ConversationId(String(prompt.sessionId))),
        refreshSessionWorkspace(prompt.sessionId),
      ])

      if (String(useChatStore.getState().activeConversationId) !== String(prompt.sessionId)) {
        return
      }

      const workspace = useSessionStore.getState().activeWorkspace
      if (workspace) {
        const contextKey = buildComposerDraftContextKey({
          projectPath: workspace.tree.session.projectPath,
          sessionId: prompt.sessionId,
          activeBranchId: workspace.activeBranchId,
          activeNodeId: workspace.activeNodeId,
        })
        const appliedDraft = useComposerStore.getState().switchScopedDraftContext(
          contextKey,
          {
            input: prompt.draftComposerText,
            attachments: [],
          },
          {
            input: prompt.draftComposerText,
            attachments: useComposerStore.getState().attachments,
          },
        )
        useComposerStore
          .getState()
          .clearScopedDraft(draftBranchComposerContextKey(prompt.sessionId, prompt.sourceNodeId))
        setComposerTextValue(appliedDraft.input)
      }

      routeToSessionSelection(prompt.sessionId, {
        branchId: workspace?.activeBranchId ?? null,
        nodeId: workspace?.activeNodeId ?? null,
      })
    } catch (summaryError) {
      if (!isCurrentBranchSummaryPrompt(prompt)) {
        return
      }
      const message = summaryError instanceof Error ? summaryError.message : String(summaryError)
      showToast(message)
      if (previousMode === 'custom') {
        useBranchSummaryStore.getState().startCustomPrompt(prompt.draftComposerText)
      } else {
        useBranchSummaryStore.getState().restoreChoice()
      }
    }
  }

  function handleSkipBranchSummary(): void {
    const prompt = useBranchSummaryStore.getState().prompt
    if (!prompt) {
      return
    }
    useBranchSummaryStore.getState().clearPrompt()
    setComposerTextValue(prompt.draftComposerText)
  }

  function handleStartCustomBranchSummary(): void {
    const prompt = useBranchSummaryStore.getState().prompt
    if (!prompt) {
      return
    }
    const composerText = useComposerStore.getState().input
    useBranchSummaryStore.getState().startCustomPrompt(composerText)
    setComposerTextValue('')
  }

  function handleCancelBranchSummary(): void {
    const prompt = useBranchSummaryStore.getState().prompt
    if (!prompt) {
      return
    }
    const restoreContextKey = buildComposerDraftContextKey({
      projectPath: activeWorkspace?.tree.session.projectPath ?? projectPath,
      sessionId: prompt.sessionId,
      activeBranchId: prompt.restoreSelection.branchId,
      activeNodeId: prompt.restoreSelection.nodeId,
    })
    const appliedDraft = useComposerStore.getState().switchScopedDraftContext(
      restoreContextKey,
      {
        input: prompt.previousComposerText,
        attachments: [],
      },
      {
        input: '',
        attachments: [],
      },
    )
    useComposerStore
      .getState()
      .clearScopedDraft(draftBranchComposerContextKey(prompt.sessionId, prompt.sourceNodeId))
    useBranchSummaryStore.getState().clearPrompt()
    clearDraftBranchForSession(prompt.sessionId)
    setComposerTextValue(appliedDraft.input)
    routeToSessionSelection(prompt.sessionId, prompt.restoreSelection)
    void refreshSessionWorkspace(prompt.sessionId, prompt.restoreSelection)
  }

  function handleSummarizeBranch(): void {
    void materializeBranchSummary()
  }

  async function materializeDraftBranchForSend(): Promise<boolean> {
    if (!activeConversationId) {
      return true
    }

    const sessionId = SessionId(String(activeConversationId))
    if (draftBranch?.sessionId !== sessionId) {
      return true
    }

    const navigation = await api.navigateSessionTree(sessionId, model, draftBranch.sourceNodeId)
    if (navigation.cancelled) {
      showToast('Branch source is no longer available.')
      return false
    }

    await refreshSessionWorkspace(sessionId, { nodeId: draftBranch.sourceNodeId })
    return true
  }

  async function handleSendWithWaggle(payload: AgentSendPayload): Promise<void> {
    const branchSummaryPrompt = useBranchSummaryStore.getState().prompt
    if (branchSummaryPrompt?.mode === 'custom') {
      await materializeBranchSummary(payload.text)
      return
    }

    const compactCommand = parseCompactCommand(payload.text)
    if (compactCommand) {
      await handleCompactSession(compactCommand.customInstructions)
      return
    }

    const draftBranchReady = await materializeDraftBranchForSend()
    if (!draftBranchReady) {
      return
    }

    setUserDidSend(true)
    phase.reset()

    try {
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
      if (activeConversationId) {
        clearDraftBranchForSession(SessionId(String(activeConversationId)))
      }
    } catch (sendError) {
      setUserDidSend(false)
      throw sendError
    }
  }

  async function handleCompactSession(customInstructions?: string): Promise<void> {
    if (!activeConversationId) {
      showToast('Nothing to compact yet.')
      return
    }

    try {
      await api.compactSession(activeConversationId, model, customInstructions)
      await Promise.all([
        refreshConversation(activeConversationId),
        refreshSessionWorkspace(SessionId(String(activeConversationId))),
      ])
    } catch (compactError) {
      const message = compactError instanceof Error ? compactError.message : String(compactError)
      showToast(message)
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

  function handleCancelRun(): void {
    if (activeConversationId && waggleStatus !== 'idle') {
      api.cancelWaggle(activeConversationId)
      stopWaggleCollaboration()
    }
    stop()
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

  function handleBranchFromMessage(messageId: string): void {
    if (!activeConversationId) {
      return
    }

    const sessionId = SessionId(String(activeConversationId))
    const previousComposerText = useComposerStore.getState().input
    const selection = createBranchDraftSelection({
      messages,
      workspace: activeWorkspace,
      messageId,
    })
    const fallbackDraftText = selection.prefillText ?? ''
    setDraftBranch({ sessionId, sourceNodeId: selection.sourceNodeId })
    const draftComposerText = switchComposerToDraftBranch({
      sessionId,
      sourceNodeId: selection.sourceNodeId,
      fallbackText: fallbackDraftText,
    })
    maybeOpenBranchSummaryPrompt({
      sessionId,
      sourceNodeId: selection.sourceNodeId,
      restoreSelection: {
        branchId: activeWorkspace?.activeBranchId ?? null,
        nodeId: activeWorkspace?.activeNodeId ?? null,
      },
      previousComposerText,
      draftComposerText,
    })
    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(sessionId) },
      search: (previous) => ({
        ...previous,
        branch: undefined,
        node: String(selection.routeNodeId),
      }),
    })

    void refreshSessionWorkspace(sessionId, { nodeId: selection.routeNodeId })
  }

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
    openSettings,
    handleBranchFromMessage,
    userDidSend,
    onUserDidSendConsumed,
    streamSignalVersion,
  })

  const composer = useComposerSection({
    isLoading,
    isSteering,
    status,
    compactionStatus,
    activeConversationId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills: catalog?.skills ?? [],
    phase,
    stop: handleCancelRun,
    showToast,
    handleSteer,
    handleSendWithWaggle,
    handleStartWaggle,
    handleStopCollaboration,
    handleSkipBranchSummary,
    handleSummarizeBranch,
    handleStartCustomBranchSummary,
    handleCancelBranchSummary,
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
