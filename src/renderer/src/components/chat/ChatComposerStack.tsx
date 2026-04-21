import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { Composer } from '@/components/composer/Composer'
import { QueuedMessages } from '@/components/composer/QueuedMessages'
import { WaggleCollaborationStatus as WaggleCollaborationStatusBanner } from '@/components/waggle/CollaborationStatus'
import { useChat } from '@/hooks/useChat'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import { ApprovalBanner } from './ApprovalBanner'
import { AskUserBlock } from './AskUserBlock'

import { PlanModeBanner } from './PlanModeBanner'
import type { ChatComposerSectionState } from './use-chat-panel-controller'

interface ChatComposerStackProps {
  readonly section: ChatComposerSectionState
}

function noOp(): void {}

export function ChatComposerStack({ section }: ChatComposerStackProps) {
  const { activeConversation } = useChat()
  const planModeActive = activeConversation?.planModeActive ?? false

  const {
    pendingApproval,
    pendingAskUser,
    activeConversationId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
    isLoading,
    status,
    onToolApprovalResponse,
    onAnswerQuestion,
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
      {pendingApproval && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <ApprovalBanner
            toolCallId={pendingApproval.toolCallId}
            toolName={pendingApproval.toolName}
            toolArgs={pendingApproval.toolArgs}
            approvalId={pendingApproval.approvalId}
            onApprovalResponse={onToolApprovalResponse}
          />
        </div>
      )}

      {pendingAskUser && activeConversationId && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <AskUserBlock
            questions={pendingAskUser.questions}
            conversationId={activeConversationId}
            onAnswer={onAnswerQuestion}
          />
        </div>
      )}

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

      {planModeActive && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <PlanModeBanner />
        </div>
      )}

      <div className="mx-auto w-full max-w-[720px] px-5 pb-5">
        <QueuedMessages
          conversationId={activeConversationId}
          onSteer={onSteer}
          isStreaming={status === 'streaming' || status === 'submitted'}
        />
        <Composer
          onSend={(payload) => {
            void onSendWithWaggle(payload)
          }}
          onEnqueue={(payload) => {
            if (activeConversationId) {
              enqueue(activeConversationId, payload)
            }
          }}
          onCancel={onCancel}
          isLoading={isLoading}
          onToast={onToast}
        />
      </div>
    </>
  )
}
