import { useMessageQueueStore } from '@/features/chat/state'
import { useBranchSummaryStore } from '@/features/chat/state/branch-summary-store'
import { CommandPalette } from '@/features/command-palette/components'
import {
  ActionDialog,
  BranchSummaryPrompt,
  CompactionStatusStrip,
  Composer,
  ComposerBranchRow,
  QueuedMessages,
} from '@/features/composer/components'
import { useScopedComposerDrafts } from '@/features/composer/hooks'
import { WaggleCollaborationStatus as WaggleCollaborationStatusBanner } from '@/features/waggle/components'
import type { ChatComposerSectionState } from '../model'
import { SessionForkSelector } from './SessionForkSelector'

interface ChatComposerStackProps {
  readonly section: ChatComposerSectionState
  readonly onOpenSessionTree?: () => void
}

function noOp() {}

export function ChatComposerStack({ section, onOpenSessionTree }: ChatComposerStackProps) {
  const {
    activeSessionId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
    forkSelectorOpen,
    forkTargets,
    isLoading,
    status,
    compactionStatus,
    onStopCollaboration,
    onSelectSkill,
    onStartWaggle,
    onSendWithWaggle,
    onSteer,
    onCancel,
    onToast,
    onSkipBranchSummary,
    onSummarizeBranch,
    onStartCustomBranchSummary,
    onCancelBranchSummary,
    onOpenForkSelector,
    onCloseForkSelector,
    onSelectForkTarget,
    onCloneToNewSession,
  } = section

  useScopedComposerDrafts(activeSessionId)

  const enqueue = useMessageQueueStore((s) => s.enqueue)
  const branchSummaryMode = useBranchSummaryStore((s) => s.prompt?.mode ?? null)
  const composerDisabledForBranchSummary =
    branchSummaryMode === 'choice' || branchSummaryMode === 'summarizing'
  const composerPlaceholder =
    branchSummaryMode === 'custom' ? 'Custom instructions for the branch summary' : undefined

  return (
    <>
      <WaggleCollaborationStatusBanner
        currentSessionId={activeSessionId}
        onStop={waggleStatus !== 'idle' ? onStopCollaboration : noOp}
      />

      {commandPaletteOpen && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <CommandPalette
            slashSkills={slashSkills}
            onSelectSkill={onSelectSkill}
            onStartWaggle={onStartWaggle}
            onOpenSessionTree={onOpenSessionTree}
            onForkToNewSession={onOpenForkSelector}
            onCloneToNewSession={onCloneToNewSession}
          />
        </div>
      )}

      <SessionForkSelector
        open={forkSelectorOpen}
        targets={forkTargets}
        onSelect={onSelectForkTarget}
        onClose={onCloseForkSelector}
      />

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
        <Composer
          onSend={onSendWithWaggle}
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
        <ComposerBranchRow onToast={onToast} />
        <ActionDialog onToast={onToast} />
      </div>
    </>
  )
}
