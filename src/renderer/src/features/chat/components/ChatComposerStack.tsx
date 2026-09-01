import type { AgentSendPayload } from '@shared/types/agent'
import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { SessionId } from '@shared/types/brand'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { useMessageQueueStore } from '@/features/chat/state'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import {
  BranchSummaryPrompt,
  CompactionStatusStrip,
  Composer,
  QueuedMessages,
} from '@/features/composer/components'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
import { ExtensionAgentLoopStatusWidgets } from '@/features/extensions'
import { WaggleCollaborationStatus as WaggleCollaborationStatusBanner } from '@/features/waggle/components'
import { projectName } from '@/shared/lib/format'
import { useComposerSendGate } from '../hooks/useComposerSendGate'
import { CHAT_CONTENT_FRAME_CLASS } from '../lib/chat-content-layout'
import type { ChatComposerSectionState } from '../model'
import { withInlineVisualizationContext } from '../state/inline-visualization-state'
import { AgentCustomInteractionComposerFallback } from './AgentCustomInteractionComposerFallback'
import { AgentInteractionComposerPrompt } from './AgentInteractionComposerPrompt'
import { ChatComposerCommandPalette } from './ChatComposerCommandPalette'
import { ChatComposerExtensionDialogs } from './ChatComposerExtensionDialogs'
import { ComposerSessionSetupDock } from './ComposerSessionSetupDock'
import { SessionAuthorizationModeMenu } from './SessionAuthorizationModeMenu'
import { SessionForkSelector } from './SessionForkSelector'

interface ChatComposerStackProps {
  readonly section: ChatComposerSectionState
  readonly agentInteractions?: readonly AgentLoopInteraction[]
  readonly extensionRegistry?: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths?: readonly string[]
  readonly onRespondAgentInteraction: (
    interaction: AgentLoopInteraction,
    response: AgentLoopInteractionResponse,
  ) => Promise<void>
  readonly onOpenSessionTree?: () => void
}

const EMPTY_AGENT_INTERACTIONS: readonly AgentLoopInteraction[] = []
const EMPTY_EXTENSION_PROJECT_PATHS: readonly string[] = []

function noOp() {}

function runStatusTone(status: ChatComposerSectionState['status']) {
  if (status === 'streaming' || status === 'submitted') return 'running' as const
  if (status === 'compacting' || status === 'retrying') return 'running' as const
  return 'neutral' as const
}

/** Last path segment, so a project-scoped approval names somewhere the user recognises. */
function projectDisplayName(projectPath: string | null) {
  if (!projectPath) return null
  return projectName(projectPath)
}

function ComposerOverlays({
  section,
  onOpenSessionTree,
}: {
  readonly section: ChatComposerSectionState
  readonly onOpenSessionTree?: () => void
}) {
  const {
    activeSessionId,
    waggleStatus,
    slashCommandMenuOpen,
    slashSkills,
    forkSelectorOpen,
    forkTargets,
    onStopCollaboration,
    onSelectSkill,
    onStartWaggle,
    onOpenForkSelector,
    onCloseForkSelector,
    onSelectForkTarget,
    onCloneToNewSession,
  } = section

  return (
    <>
      <WaggleCollaborationStatusBanner
        currentSessionId={activeSessionId}
        onStop={waggleStatus !== 'idle' ? onStopCollaboration : noOp}
      />
      <ChatComposerCommandPalette
        open={slashCommandMenuOpen}
        slashSkills={slashSkills}
        onSelectSkill={onSelectSkill}
        onStartWaggle={onStartWaggle}
        onOpenSessionTree={onOpenSessionTree}
        onForkToNewSession={onOpenForkSelector}
        onCloneToNewSession={onCloneToNewSession}
      />
      <SessionForkSelector
        open={forkSelectorOpen}
        targets={forkTargets}
        onSelect={onSelectForkTarget}
        onClose={onCloseForkSelector}
      />
    </>
  )
}

/**
 * The composer stack.
 *
 * The control row below the input uses `min-h-7` with `flex-wrap` rather than a fixed
 * height. The compact controls are shorter than 28px so the envelope is unchanged, but the
 * vanished-worktree notice needs room for its message and actions: inside a fixed-height
 * row flex shrank it to zero width and left its buttons underneath the run-target picker,
 * unclickable in the app while component tests passed.
 */
/**
 * Queueing runs the same gate as sending.
 *
 * A queued message is dispatched later with the raw send, so queueing was a way straight past the
 * gate: main rejected it with a bare thrown error - its own comment says reaching there means
 * something bypassed the gate - and the message was silently re-enqueued instead of the user
 * seeing the recover-or-switch notice.
 */
export function enqueueIfAllowed(input: {
  readonly payload: AgentSendPayload
  readonly activeSessionId: SessionId | null
  readonly sendBlockedReason: string | null
  readonly enqueue: (sessionId: SessionId, payload: AgentSendPayload) => void
  readonly onToast: (message: string) => void
}) {
  if (input.sendBlockedReason !== null) {
    input.onToast(input.sendBlockedReason)
    return
  }
  if (input.activeSessionId) {
    input.enqueue(
      input.activeSessionId,
      withInlineVisualizationContext(input.activeSessionId, input.payload),
    )
  }
}

export function ChatComposerStack({
  section,
  agentInteractions = EMPTY_AGENT_INTERACTIONS,
  extensionRegistry = null,
  extensionProjectPaths = EMPTY_EXTENSION_PROJECT_PATHS,
  onRespondAgentInteraction,
  onOpenSessionTree,
}: ChatComposerStackProps) {
  const {
    activeSessionId,
    isLoading,
    status,
    compactionStatus,
    onSendWithWaggle,
    onSteer,
    onCancel,
    onToast,
    onSkipBranchSummary,
    onSummarizeBranch,
    onStartCustomBranchSummary,
    onCancelBranchSummary,
  } = section
  useScopedComposerDrafts(activeSessionId)
  const { strip, guardedSend, sendBlockedReason } = useComposerSendGate({
    activeSessionId,
    session: section.session,
    isFirstMessage: section.isFirstMessage,
    onSend: onSendWithWaggle,
    onToast,
  })
  const enqueue = useMessageQueueStore((s) => s.enqueue)
  const branchSummaryMode = useBranchSummaryStore((s) => s.prompt?.mode ?? null)
  const composerDisabledForBranchSummary =
    branchSummaryMode === 'choice' || branchSummaryMode === 'summarizing'
  const composerPlaceholder =
    branchSummaryMode === 'custom' ? 'Custom instructions for the branch summary' : undefined
  return (
    <>
      <ComposerOverlays section={section} onOpenSessionTree={onOpenSessionTree} />

      <div className={`${CHAT_CONTENT_FRAME_CLASS} pb-5`} data-chat-composer-form="true">
        {compactionStatus?.type === 'retrying' ? (
          <CompactionStatusStrip state={compactionStatus} onCancel={onCancel} />
        ) : null}
        <QueuedMessages
          sessionId={activeSessionId}
          onSteer={onSteer}
          isStreaming={status !== 'ready' && status !== 'error'}
        />
        <BranchSummaryPrompt
          onNoSummary={onSkipBranchSummary}
          onSummarize={onSummarizeBranch}
          onCustomSummary={onStartCustomBranchSummary}
          onCancel={onCancelBranchSummary}
        />
        <AgentInteractionComposerPrompt
          interactions={agentInteractions}
          onRespond={onRespondAgentInteraction}
          projectName={projectDisplayName(section.session?.projectPath ?? null)}
        />
        <AgentCustomInteractionComposerFallback
          extensionProjectPaths={extensionProjectPaths}
          extensionRegistry={extensionRegistry}
          interactions={agentInteractions}
          onRespond={onRespondAgentInteraction}
        />
        <ChatComposerExtensionDialogs
          agentInteractions={agentInteractions}
          extensionProjectPaths={extensionProjectPaths}
          extensionRegistry={extensionRegistry}
          onRespond={onRespondAgentInteraction}
        />
        <div className="contents" data-extension-run-status-host="true">
          <ExtensionAgentLoopStatusWidgets
            input={{
              surface: 'status',
              status: {
                label: 'Run status',
                tone: runStatusTone(section.status),
              },
            }}
            projectPaths={extensionProjectPaths}
            registry={extensionRegistry}
          />
        </div>
        <div>
          <ComposerSessionSetupDock section={section} strip={strip} />
          <Composer
            accessControl={
              <SessionAuthorizationModeMenu
                projectPath={section.projectPath ?? null}
                session={section.session}
                onSetAuthorizationMode={section.onSetAuthorizationMode}
              />
            }
            onSend={guardedSend}
            onEnqueue={(payload) =>
              enqueueIfAllowed({ payload, activeSessionId, sendBlockedReason, enqueue, onToast })
            }
            onCancel={onCancel}
            isLoading={isLoading}
            mode={{
              disabled: composerDisabledForBranchSummary,
              placeholder: composerPlaceholder,
              requiresText: branchSummaryMode === 'custom',
              clearOnSubmit: branchSummaryMode !== 'custom',
              recordHistory: branchSummaryMode !== 'custom',
              allowEnqueue: branchSummaryMode !== 'custom',
              sendTitle: branchSummaryMode === 'custom' ? 'Summarize branch' : undefined,
            }}
            onToast={onToast}
          />
        </div>
      </div>
    </>
  )
}
