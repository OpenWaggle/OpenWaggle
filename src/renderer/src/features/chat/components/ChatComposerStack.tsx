import type {
  AgentLoopInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { useMessageQueueStore } from '@/features/chat/state'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import {
  ActionDialog,
  BranchSummaryPrompt,
  CompactionStatusStrip,
  Composer,
  ComposerBranchRow,
  QueuedMessages,
} from '@/features/composer/components'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
import { SessionContextRow, type SessionContextRowState } from '@/features/git'
import { WaggleCollaborationStatus as WaggleCollaborationStatusBanner } from '@/features/waggle/components'
import { useComposerSendGate } from '../hooks/useComposerSendGate'
import type { ChatComposerSectionState } from '../model'
import { AgentCustomInteractionComposerFallback } from './AgentCustomInteractionComposerFallback'
import { AgentInteractionComposerPrompt } from './AgentInteractionComposerPrompt'
import { ChatComposerCommandPalette } from './ChatComposerCommandPalette'
import { ChatComposerExtensionDialogs } from './ChatComposerExtensionDialogs'
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

/** Last path segment, so a project-scoped approval names somewhere the user recognises. */
function projectDisplayName(projectPath: string | null) {
  if (!projectPath) return null
  const segments = projectPath.split('/').filter((segment) => segment.length > 0)
  return segments.at(-1) ?? null
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

function ComposerControlRow({
  strip,
  session,
  onSetAuthorizationMode,
  onToast,
}: {
  readonly strip: SessionContextRowState
  readonly session: ChatComposerSectionState['session']
  readonly onSetAuthorizationMode: ChatComposerSectionState['onSetAuthorizationMode']
  readonly onToast: ChatComposerSectionState['onToast']
}) {
  return (
    <div className="mt-1.5 flex min-h-7 min-w-0 flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SessionAuthorizationModeMenu
          session={session}
          onSetAuthorizationMode={onSetAuthorizationMode}
        />
        <SessionContextRow strip={strip} />
      </div>
      <ComposerBranchRow strip={strip} onToast={onToast} />
    </div>
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
    onSetAuthorizationMode,
  } = section
  useScopedComposerDrafts(activeSessionId)
  const { strip, guardedSend } = useComposerSendGate({
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

      <div className="mx-auto w-full max-w-[720px] px-5 pb-5" data-chat-composer-form="true">
        {compactionStatus ? (
          <CompactionStatusStrip state={compactionStatus} onCancel={onCancel} />
        ) : null}
        <QueuedMessages
          sessionId={activeSessionId}
          onSteer={onSteer}
          isStreaming={status === 'streaming' || status === 'submitted'}
          isCompacting={status === 'compacting' || status === 'retrying'}
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
        <Composer
          onSend={guardedSend}
          onEnqueue={(payload) => {
            if (activeSessionId) {
              enqueue(activeSessionId, payload)
            }
          }}
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
        <ComposerControlRow
          strip={strip}
          session={section.session}
          onSetAuthorizationMode={onSetAuthorizationMode}
          onToast={onToast}
        />
        <ActionDialog onToast={onToast} />
      </div>
    </>
  )
}
