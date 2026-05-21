import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionBranchId, SessionId } from '@shared/types/brand'
import { cn } from '@/shared/lib/cn'
import { useChatScrollBehaviour } from '../hooks/useChatScrollBehaviour'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../model'
import { ChatRowRenderer } from './ChatRowRenderer'
import { ScrollToBottomButton } from './ScrollToBottomButton'
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

function getChatRowKey(row: ChatRow) {
  return matchBy(row, 'type')
    .with('message', (value) => `message:${value.message.id}`)
    .with('waggle-turn', (value) => value.id)
    .with('interrupted-run', (value) => `interrupted-run:${value.runId}`)
    .with('branch-summary', (value) => `branch-summary:${value.id}`)
    .with('compaction-summary', (value) => `compaction:${value.id}`)
    .with('phase-indicator', (value) => `phase:${value.label}`)
    .with('run-summary', (value) => `run-summary:${String(value.totalMs)}`)
    .with('error', (value) => `error:${value.sessionId ?? 'none'}:${value.error.message}`)
    .exhaustive()
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
