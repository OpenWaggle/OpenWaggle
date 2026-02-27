import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { Composer } from '@/components/composer/Composer'
import { WaggleCollaborationStatus as WaggleCollaborationStatusBanner } from '@/components/waggle/CollaborationStatus'
import { ApprovalBanner } from './ApprovalBanner'
import { AskUserBlock } from './AskUserBlock'
import type { ChatComposerSectionState } from './use-chat-panel-controller'

interface ChatComposerStackProps {
  readonly section: ChatComposerSectionState
}

function noOp(): void {}

export function ChatComposerStack({ section }: ChatComposerStackProps): React.JSX.Element {
  const {
    pendingApproval,
    pendingAskUser,
    activeConversationId,
    waggleStatus,
    commandPaletteOpen,
    slashSkills,
    isLoading,
    onToolApprovalResponse,
    onAnswerQuestion,
    onStopCollaboration,
    onSelectSkill,
    onStartWaggle,
    onSendWithWaggle,
    onCancel,
    onToast,
  } = section

  return (
    <>
      {pendingApproval && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <ApprovalBanner
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

      <div className="mx-auto w-full max-w-[720px] px-5 pb-5">
        <Composer
          onSend={(payload) => {
            void onSendWithWaggle(payload)
          }}
          onCancel={onCancel}
          isLoading={isLoading}
          onToast={onToast}
        />
      </div>
    </>
  )
}
