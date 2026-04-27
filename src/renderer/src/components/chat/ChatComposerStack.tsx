import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { ActionDialog } from '@/components/composer/ActionDialog'
import { CompactionStatusStrip } from '@/components/composer/CompactionStatusStrip'
import { Composer } from '@/components/composer/Composer'
import { ComposerBranchRow } from '@/components/composer/ComposerBranchRow'
import { QueuedMessages } from '@/components/composer/QueuedMessages'
import { WaggleCollaborationStatus as WaggleCollaborationStatusBanner } from '@/components/waggle/CollaborationStatus'
import { useMessageQueueStore } from '@/stores/message-queue-store'

import type { ChatComposerSectionState } from './use-chat-panel-controller'

interface ChatComposerStackProps {
  readonly section: ChatComposerSectionState
}

function noOp(): void {}

export function ChatComposerStack({ section }: ChatComposerStackProps) {
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
  } = section

  const enqueue = useMessageQueueStore((s) => s.enqueue)

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
        <Composer
          onSend={onSendWithWaggle}
          onEnqueue={(payload) => {
            if (activeConversationId) {
              enqueue(activeConversationId, payload)
            }
          }}
          onCancel={onCancel}
          isLoading={isLoading}
          onToast={onToast}
        />
        <ComposerBranchRow onToast={onToast} />
        <ActionDialog onToast={onToast} />
      </div>
    </>
  )
}
