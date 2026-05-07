import type { SessionBranchId, SessionId } from '@shared/types/brand'
import { chooseBy } from '@shared/utils/decision'
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
  sessionId: SessionId | null
  onOpenSettings: () => void
  onRetryText: (content: string) => Promise<void>
  onDismissError: (errorId: string | null) => void
  onDismissInterruptedRun: (runId: string, branchId: SessionBranchId) => void
  onBranchFromMessage: (messageId: string) => void
  onForkFromMessage: (messageId: string) => void
}

function TranscriptRow({
  row,
  sessionId,
  onOpenSettings,
  onRetryText,
  onDismissError,
  onDismissInterruptedRun,
  onBranchFromMessage,
  onForkFromMessage,
}: TranscriptRowProps) {
  return (
    <ChatRowRenderer
      row={row}
      sessionId={sessionId}
      onOpenSettings={onOpenSettings}
      onRetry={(content) => {
        void onRetryText(content)
      }}
      onDismissError={onDismissError}
      onDismissInterruptedRun={onDismissInterruptedRun}
      onBranchFromMessage={onBranchFromMessage}
      onForkFromMessage={onForkFromMessage}
    />
  )
}

function getChatRowKey(row: ChatRow): string {
  return chooseBy(row, 'type')
    .case('message', (value) => `message:${value.message.id}`)
    .case('waggle-turn', (value) => value.id)
    .case('interrupted-run', (value) => `interrupted-run:${value.runId}`)
    .case('branch-summary', (value) => `branch-summary:${value.id}`)
    .case('compaction-summary', (value) => `compaction:${value.id}`)
    .case('phase-indicator', (value) => `phase:${value.label}`)
    .case('run-summary', (value) => `run-summary:${String(value.totalMs)}`)
    .case('error', (value) => `error:${value.sessionId ?? 'none'}:${value.error.message}`)
    .assertComplete()
}

// ─── Row Rendering ──────────────────────────────────────────

interface RenderTranscriptRowsParams {
  rows: ChatRow[]
  activeSessionId: SessionId | null
  onOpenSettings: () => void
  onRetryText: (content: string) => Promise<void>
  onDismissError: (errorId: string | null) => void
  onDismissInterruptedRun: (runId: string, branchId: SessionBranchId) => void
  onBranchFromMessage: (messageId: string) => void
  onForkFromMessage: (messageId: string) => void
}

function TranscriptRows(params: RenderTranscriptRowsParams) {
  const {
    rows,
    activeSessionId,
    onOpenSettings,
    onRetryText,
    onDismissError,
    onDismissInterruptedRun,
    onBranchFromMessage,
    onForkFromMessage,
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
              sessionId={activeSessionId}
              onOpenSettings={onOpenSettings}
              onRetryText={onRetryText}
              onDismissError={onDismissError}
              onDismissInterruptedRun={onDismissInterruptedRun}
              onBranchFromMessage={onBranchFromMessage}
              onForkFromMessage={onForkFromMessage}
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
    activeSessionId,
    chatRows: rows,
    onOpenProject,
    onSelectProjectPath,
    onRetryText,
    onOpenSettings,
    onDismissError,
    onDismissInterruptedRun,
    onBranchFromMessage,
    onForkFromMessage,
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
    activeSessionId: activeSessionId ?? null,
    lastUserMessageId,
    rowsLength: rows.length,
    streamVersion: streamSignalVersion,
    isLoading,
    userDidSend,
    onUserDidSendConsumed,
  })

  if (messages.length === 0 && rows.length === 0 && !isLoading) {
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
            activeSessionId={activeSessionId}
            onOpenSettings={onOpenSettings}
            onRetryText={onRetryText}
            onDismissError={onDismissError}
            onDismissInterruptedRun={onDismissInterruptedRun}
            onBranchFromMessage={onBranchFromMessage}
            onForkFromMessage={onForkFromMessage}
          />
        </div>
      </div>

      <ScrollToBottomButton visible={showScrollToBottom} onClick={scrollToBottom} />
    </div>
  )
}
