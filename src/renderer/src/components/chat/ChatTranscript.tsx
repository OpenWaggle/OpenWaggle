import type { ConversationId } from '@shared/types/brand'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import { chooseBy } from '@shared/utils/decision'
import { ChatRowRenderer } from './ChatRowRenderer'
import { useChatScrollBehaviour } from './hooks/useChatScrollBehaviour'
import type { ChatRow } from './types-chat-row'
import type { ChatTranscriptSectionState } from './use-chat-panel-controller'
import { WelcomeScreen } from './WelcomeScreen'

const PADDING_TOP = 20

interface ChatTranscriptProps {
  readonly section: ChatTranscriptSectionState
}

function renderTranscriptRow(
  row: ChatRow,
  conversationId: ConversationId | null,
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>,
  onRespondToPlan: (conversationId: ConversationId, response: PlanResponse) => Promise<void>,
  onOpenSettings: () => void,
  onRetryText: (content: string) => Promise<void>,
  onDismissError: (errorId: string | null) => void,
): React.JSX.Element {
  return (
    <ChatRowRenderer
      row={row}
      conversationId={conversationId}
      onAnswerQuestion={onAnswerQuestion}
      onRespondToPlan={onRespondToPlan}
      onOpenSettings={onOpenSettings}
      onRetry={(content) => {
        void onRetryText(content)
      }}
      onDismissError={onDismissError}
    />
  )
}

function getChatRowKey(row: ChatRow): string {
  return chooseBy(row, 'type')
    .case('message', (value) => `message:${value.message.id}`)
    .case('segment', (value) => `segment:${value.segment.id}`)
    .case('phase-indicator', (value) => `phase:${value.label}`)
    .case('run-summary', (value) => `run-summary:${String(value.totalMs)}`)
    .case('error', (value) => `error:${value.conversationId ?? 'none'}:${value.error.message}`)
    .assertComplete()
}

export function ChatTranscript({ section }: ChatTranscriptProps): React.JSX.Element {
  const {
    messages,
    isLoading,
    projectPath,
    recentProjects,
    activeConversationId,
    chatRows: rows,
    onOpenProject,
    onSelectProjectPath,
    onRetryText,
    onAnswerQuestion,
    onRespondToPlan,
    onOpenSettings,
    onDismissError,
    lastUserMessageId,
  } = section

  const { scrollerRef, spacerRef, userMessageRef, handleScroll } = useChatScrollBehaviour({
    lastUserMessageId,
    messagesLength: messages.length,
    rowsLength: rows.length,
    isLoading,
    activeConversationId,
  })

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 overflow-y-auto chat-scroll">
        <WelcomeScreen
          projectPath={projectPath}
          hasProject={!!projectPath}
          recentProjects={recentProjects}
          onOpenProject={() => {
            void onOpenProject()
          }}
          onSelectProjectPath={onSelectProjectPath}
          onRetry={(content) => {
            void onRetryText(content)
          }}
        />
      </div>
    )
  }

  return (
    <div
      ref={scrollerRef}
      role="log"
      aria-label="Chat messages"
      aria-busy={isLoading}
      className="relative flex flex-1 flex-col overflow-y-auto chat-scroll [overflow-anchor:none]"
      onScroll={handleScroll}
    >
      {rows.map((row, index) => {
        const isUserMessage = row.type === 'message' && row.message.role === 'user'
        const isScrollTarget = isUserMessage && row.message.id === lastUserMessageId
        return (
          <div
            key={getChatRowKey(row)}
            ref={isScrollTarget ? userMessageRef : undefined}
            className="mx-auto w-full max-w-[720px] px-12 pb-6"
            {...(isUserMessage ? { 'data-user-message-id': row.message.id } : {})}
            style={index === 0 ? { paddingTop: PADDING_TOP } : undefined}
          >
            {renderTranscriptRow(
              row,
              activeConversationId,
              onAnswerQuestion,
              onRespondToPlan,
              onOpenSettings,
              onRetryText,
              onDismissError,
            )}
          </div>
        )
      })}
      {messages.length > 1 && (
        <div ref={spacerRef} aria-hidden="true" style={{ flexShrink: 0, pointerEvents: 'none' }} />
      )}
    </div>
  )
}
