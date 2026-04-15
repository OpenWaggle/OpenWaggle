import type { ConversationId } from '@shared/types/brand'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import { chooseBy } from '@shared/utils/decision'
import { ChatRowRenderer } from './ChatRowRenderer'
import { CompactedMessageGroup } from './CompactedMessageGroup'
import { useChatScrollBehaviour } from './hooks/useChatScrollBehaviour'
import type { ChatRow } from './types-chat-row'
import type { ChatTranscriptSectionState } from './use-chat-panel-controller'
import { WelcomeScreen } from './WelcomeScreen'

const PADDING_TOP = 20
const EMPTY_SET: ReadonlySet<string> = new Set()

interface ChatTranscriptProps {
  readonly section: ChatTranscriptSectionState
}

interface TranscriptRowProps {
  row: ChatRow
  conversationId: ConversationId | null
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  onRespondToPlan: (conversationId: ConversationId, response: PlanResponse) => Promise<void>
  onOpenSettings: () => void
  onRetryText: (content: string) => Promise<void>
  onDismissError: (errorId: string | null) => void
}

function TranscriptRow({
  row,
  conversationId,
  onAnswerQuestion,
  onRespondToPlan,
  onOpenSettings,
  onRetryText,
  onDismissError,
}: TranscriptRowProps) {
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
    .case('compaction-event', (value) => `compaction:${value.messageId}`)
    .case('error', (value) => `error:${value.conversationId ?? 'none'}:${value.error.message}`)
    .assertComplete()
}

// ─── Row Rendering with Compacted Message Grouping ──────────

interface RenderTranscriptRowsParams {
  rows: ChatRow[]
  compactedMessageIds: ReadonlySet<string>
  lastUserMessageId: string | null
  userMessageRef: React.RefObject<HTMLDivElement | null>
  activeConversationId: ConversationId | null
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  onRespondToPlan: (conversationId: ConversationId, response: PlanResponse) => Promise<void>
  onOpenSettings: () => void
  onRetryText: (content: string) => Promise<void>
  onDismissError: (errorId: string | null) => void
}

function renderTranscriptRows(params: RenderTranscriptRowsParams): React.ReactNode[] {
  const {
    rows,
    compactedMessageIds,
    lastUserMessageId,
    userMessageRef,
    activeConversationId,
    onAnswerQuestion,
    onRespondToPlan,
    onOpenSettings,
    onRetryText,
    onDismissError,
  } = params

  const elements: React.ReactNode[] = []
  let compactedGroup: React.ReactNode[] = []
  let compactedGroupKey = ''

  function flushCompactedGroup() {
    if (compactedGroup.length === 0) return
    elements.push(
      <div
        key={`compacted-${compactedGroupKey}`}
        className="mx-auto w-full max-w-[720px] px-12 pb-2"
      >
        <CompactedMessageGroup count={compactedGroup.length}>
          {compactedGroup}
        </CompactedMessageGroup>
      </div>,
    )
    compactedGroup = []
    compactedGroupKey = ''
  }

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const isUserMessage = row.type === 'message' && row.message.role === 'user'
    const isScrollTarget = isUserMessage && row.message.id === lastUserMessageId
    const isCompacted =
      (row.type === 'message' || row.type === 'segment') &&
      compactedMessageIds.has(row.type === 'message' ? row.message.id : row.parentMessage.id)

    if (isCompacted) {
      if (compactedGroupKey === '') compactedGroupKey = getChatRowKey(row)
      compactedGroup.push(
        <div key={getChatRowKey(row)} className="mx-auto w-full max-w-[720px] px-12 pb-6">
          <TranscriptRow
            row={row}
            conversationId={activeConversationId}
            onAnswerQuestion={onAnswerQuestion}
            onRespondToPlan={onRespondToPlan}
            onOpenSettings={onOpenSettings}
            onRetryText={onRetryText}
            onDismissError={onDismissError}
          />
        </div>,
      )
      continue
    }

    flushCompactedGroup()

    elements.push(
      <div
        key={getChatRowKey(row)}
        ref={isScrollTarget ? userMessageRef : undefined}
        className="mx-auto w-full max-w-[720px] px-12 pb-6"
        {...(isUserMessage ? { 'data-user-message-id': row.message.id } : {})}
        style={index === 0 ? { paddingTop: PADDING_TOP } : undefined}
      >
        <TranscriptRow
          row={row}
          conversationId={activeConversationId}
          onAnswerQuestion={onAnswerQuestion}
          onRespondToPlan={onRespondToPlan}
          onOpenSettings={onOpenSettings}
          onRetryText={onRetryText}
          onDismissError={onDismissError}
        />
      </div>,
    )
  }

  flushCompactedGroup()
  return elements
}

// ─── Component ──────────────────────────────────────────────

export function ChatTranscript({ section }: ChatTranscriptProps) {
  const {
    messages,
    isLoading,
    disableAutoFollowDuringWaggleStreaming,
    projectPath,
    recentProjects,
    activeConversationId,
    chatRows: rows,
    compactedMessageIds = EMPTY_SET,
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
    disableAutoFollowDuringWaggleStreaming,
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
      {renderTranscriptRows({
        rows,
        compactedMessageIds,
        lastUserMessageId,
        userMessageRef,
        activeConversationId,
        onAnswerQuestion,
        onRespondToPlan,
        onOpenSettings,
        onRetryText,
        onDismissError,
      })}
      {messages.length > 0 && (
        <div ref={spacerRef} aria-hidden="true" style={{ flexShrink: 0, pointerEvents: 'none' }} />
      )}
    </div>
  )
}
