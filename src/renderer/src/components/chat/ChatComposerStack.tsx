import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { ActionDialog } from '@/components/composer/ActionDialog'
import { BranchSummaryPrompt } from '@/components/composer/BranchSummaryPrompt'
import { CompactionStatusStrip } from '@/components/composer/CompactionStatusStrip'
import { Composer } from '@/components/composer/Composer'
import { ComposerBranchRow } from '@/components/composer/ComposerBranchRow'
import { QueuedMessages } from '@/components/composer/QueuedMessages'
import { useScopedComposerDrafts } from '@/components/composer/useScopedComposerDrafts'
import { WaggleCollaborationStatus as WaggleCollaborationStatusBanner } from '@/components/waggle/CollaborationStatus'
import { useBranchSummaryStore } from '@/stores/branch-summary-store'
import { useMessageQueueStore } from '@/stores/message-queue-store'

import type { ChatComposerSectionState } from './use-chat-panel-controller'

interface ChatComposerStackProps {
  readonly section: ChatComposerSectionState
  readonly onOpenSessionTree?: () => void
}

function noOp(): void {}

export function ChatComposerStack({ section, onOpenSessionTree }: ChatComposerStackProps) {
  const {
    activeConversationId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
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
  } = section

  useScopedComposerDrafts(activeConversationId)

  const enqueue = useMessageQueueStore((s) => s.enqueue)
  const branchSummaryMode = useBranchSummaryStore((s) => s.prompt?.mode ?? null)
  const composerDisabledForBranchSummary =
    branchSummaryMode === 'choice' || branchSummaryMode === 'summarizing'
  const composerPlaceholder =
    branchSummaryMode === 'custom' ? 'Custom instructions for the branch summary' : undefined

  return (
    <>
      <WaggleCollaborationStatusBanner
        currentConversationId={activeConversationId}
        onStop={waggleStatus !== 'idle' ? onStopCollaboration : noOp}
      />

      {commandPaletteOpen && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <CommandPalette
            slashSkills={slashSkills}
            onSelectSkill={onSelectSkill}
            onStartWaggle={onStartWaggle}
            onOpenSessionTree={onOpenSessionTree}
          />
        </div>
      )}

      <div className="mx-auto w-full max-w-[720px] px-5 pb-5" data-chat-composer-form="true">
        {compactionStatus ? (
          <CompactionStatusStrip state={compactionStatus} onCancel={onCancel} />
        ) : null}
        <QueuedMessages
          conversationId={activeConversationId}
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
            if (activeConversationId) {
              enqueue(activeConversationId, payload)
            }
          }}
          onCancel={onCancel}
          isLoading={isLoading}
          disabled={composerDisabledForBranchSummary}
          placeholder={composerPlaceholder}
          requiresText={branchSummaryMode === 'custom'}
          clearOnSubmit={branchSummaryMode !== 'custom'}
          recordHistory={branchSummaryMode !== 'custom'}
          allowEnqueue={branchSummaryMode !== 'custom'}
          sendTitle={branchSummaryMode === 'custom' ? 'Summarize branch' : undefined}
          onToast={onToast}
        />
        <ComposerBranchRow onToast={onToast} />
        <ActionDialog onToast={onToast} />
      </div>
    </>
  )
}
