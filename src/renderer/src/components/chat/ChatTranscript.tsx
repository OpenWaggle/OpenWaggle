import type { ConversationId } from '@shared/types/brand'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import { chooseBy } from '@shared/utils/decision'
import type { UIMessage } from '@tanstack/ai-react'
import { cn } from '@/lib/cn'
import { ChatRowRenderer } from './ChatRowRenderer'
import { CompactedMessageGroup } from './CompactedMessageGroup'
import { useChatScrollBehaviour } from './hooks/useChatScrollBehaviour'
import { ScrollToBottomButton } from './ScrollToBottomButton'
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

function getStreamPartVersion(part: UIMessage['parts'][number]): number {
  return chooseBy(part, 'type')
    .case('text', (value) => value.content.length)
    .case('thinking', (value) => value.content.length)
    .case(
      'tool-call',
      (value) =>
        value.id.length +
        value.name.length +
        value.arguments.length +
        value.state.length +
        (value.approval?.approved === undefined ? 0 : 1) +
        (value.output === undefined ? 0 : 1),
    )
    .case(
      'tool-result',
      (value) =>
        value.toolCallId.length +
        value.content.length +
        value.state.length +
        (value.error?.length ?? 0),
    )
    .case('image', (value) => value.source.value.length)
    .case('audio', (value) => value.source.value.length)
    .case('video', (value) => value.source.value.length)
    .case('document', (value) => value.source.value.length)
    .assertComplete()
}

function getStreamVersion(messages: readonly UIMessage[]): number {
  let version = messages.length
  for (const message of messages) {
    version += message.id.length + message.role.length + message.parts.length
    for (const part of message.parts) {
      version += getStreamPartVersion(part)
    }
  }
  return version
}

// ─── Row Rendering with Compacted Message Grouping ──────────

interface RenderTranscriptRowsParams {
  rows: ChatRow[]
  compactedMessageIds: ReadonlySet<string>
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
    userDidSend,
    onUserDidSendConsumed,
  } = section

  const {
    scrollerRef,
    contentRef,
    showScrollbar,
    showScrollToBottom,
    scrollToBottom,
    handleScroll,
    handleWheel,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  } = useChatScrollBehaviour({
    activeConversationId: activeConversationId ?? null,
    lastUserMessageId,
    rowsLength: rows.length,
    streamVersion: getStreamVersion(messages),
    isLoading,
    userDidSend,
    onUserDidSendConsumed,
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
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div
        ref={scrollerRef}
        role="log"
        aria-label="Chat messages"
        aria-busy={isLoading}
        className={cn(
          'flex flex-1 flex-col overflow-y-auto chat-scroll [overflow-anchor:none]',
          showScrollbar && 'is-scrolling',
        )}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div ref={contentRef} className="flex min-h-full flex-col">
          {renderTranscriptRows({
            rows,
            compactedMessageIds,
            activeConversationId,
            onAnswerQuestion,
            onRespondToPlan,
            onOpenSettings,
            onRetryText,
            onDismissError,
          })}
        </div>
      </div>

      <ScrollToBottomButton visible={showScrollToBottom} onClick={scrollToBottom} />
    </div>
  )
}
