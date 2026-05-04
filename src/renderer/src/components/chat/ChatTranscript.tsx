import { matchBy } from '@diegogbrisa/ts-match'
import type { ConversationId } from '@shared/types/brand'
import { cn } from '@/lib/cn'
import { ChatRowRenderer } from './ChatRowRenderer'
import { useChatScrollBehaviour } from './hooks/useChatScrollBehaviour'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import type { ChatRow } from './types-chat-row'
import type { ChatTranscriptSectionState } from './use-chat-panel-controller'
import { WelcomeScreen } from './WelcomeScreen'

const PADDING_TOP = 20

interface ChatTranscriptProps {
  readonly section: ChatTranscriptSectionState
}

interface TranscriptRowProps {
  row: ChatRow
  conversationId: ConversationId | null
  onOpenSettings: () => void
  onRetryText: (content: string) => Promise<void>
  onDismissError: (errorId: string | null) => void
  onBranchFromMessage: (messageId: string) => void
}

function TranscriptRow({
  row,
  conversationId,
  onOpenSettings,
  onRetryText,
  onDismissError,
  onBranchFromMessage,
}: TranscriptRowProps) {
  return (
    <ChatRowRenderer
      row={row}
      conversationId={conversationId}
      onOpenSettings={onOpenSettings}
      onRetry={(content) => {
        void onRetryText(content)
      }}
      onDismissError={onDismissError}
      onBranchFromMessage={onBranchFromMessage}
    />
  )
}

function getChatRowKey(row: ChatRow): string {
  return matchBy(row, 'type')
    .with('message', (value) => `message:${value.message.id}`)
    .with('compaction-summary', (value) => `compaction:${value.id}`)
    .with('phase-indicator', (value) => `phase:${value.label}`)
    .with('run-summary', (value) => `run-summary:${String(value.totalMs)}`)
    .with('error', (value) => `error:${value.conversationId ?? 'none'}:${value.error.message}`)
    .exhaustive()
}

// ─── Row Rendering ──────────────────────────────────────────

interface RenderTranscriptRowsParams {
  rows: ChatRow[]
  activeConversationId: ConversationId | null
  onOpenSettings: () => void
  onRetryText: (content: string) => Promise<void>
  onDismissError: (errorId: string | null) => void
  onBranchFromMessage: (messageId: string) => void
}

function TranscriptRows(params: RenderTranscriptRowsParams) {
  const {
    rows,
    activeConversationId,
    onOpenSettings,
    onRetryText,
    onDismissError,
    onBranchFromMessage,
  } = params

  return (
    <>
      {rows.map((row, index) => {
        const isUserMessage = row.type === 'message' && row.message.role === 'user'
        return (
          <div
            key={getChatRowKey(row)}
            className="mx-auto w-full max-w-[720px] px-12 pb-6"
            {...(isUserMessage ? { 'data-user-message-id': row.message.id } : {})}
            style={index === 0 ? { paddingTop: PADDING_TOP } : undefined}
          >
            <TranscriptRow
              row={row}
              conversationId={activeConversationId}
              onOpenSettings={onOpenSettings}
              onRetryText={onRetryText}
              onDismissError={onDismissError}
              onBranchFromMessage={onBranchFromMessage}
            />
          </div>
        )
      })}
    </>
  )
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
    onOpenProject,
    onSelectProjectPath,
    onRetryText,
    onOpenSettings,
    onDismissError,
    onBranchFromMessage,
    lastUserMessageId,
    streamSignalVersion,
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
    streamVersion: streamSignalVersion,
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
          onRetry={
            projectPath
              ? (content) => {
                  void onRetryText(content)
                }
              : undefined
          }
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
          <TranscriptRows
            rows={rows}
            activeConversationId={activeConversationId}
            onOpenSettings={onOpenSettings}
            onRetryText={onRetryText}
            onDismissError={onDismissError}
            onBranchFromMessage={onBranchFromMessage}
          />
        </div>
      </div>

      <ScrollToBottomButton visible={showScrollToBottom} onClick={scrollToBottom} />
    </div>
  )
}
