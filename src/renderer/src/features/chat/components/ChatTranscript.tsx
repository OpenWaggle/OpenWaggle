import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { cn } from '@/shared/lib/cn'
import { useChatScrollBehaviour } from '../hooks/useChatScrollBehaviour'
import type { ChatRow } from '../lib/types-chat-row'
import type { ChatTranscriptSectionState } from '../model'
import type { ChatRowRenderContext } from './ChatRowRenderContext'
import { ChatRowRenderer } from './ChatRowRenderer'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import { WelcomeScreen } from './WelcomeScreen'

const PADDING_TOP = 20

interface ChatTranscriptProps {
  readonly section: ChatTranscriptSectionState
}

function getChatRowKey(row: ChatRow) {
  return matchBy(row, 'type')
    .with('message', (value) => `message:${value.message.id}`)
    .with('waggle-turn', (value) => value.id)
    .with('interrupted-run', (value) => `interrupted-run:${value.runId}`)
    .with(
      'agent-loop-custom-message',
      (value) => `custom:${value.event.timestamp}:${value.event.name}`,
    )
    .with('agent-loop-interaction-event', (value) =>
      value.event.type === 'agent_interaction_request'
        ? `interaction-request:${value.event.interaction.interactionId}`
        : `interaction-resolved:${value.event.interactionId}`,
    )
    .with('branch-summary', (value) => `branch-summary:${value.id}`)
    .with('compaction-summary', (value) => `compaction:${value.id}`)
    .with('phase-indicator', (value) => `phase:${value.label}`)
    .with('run-summary', (value) => `run-summary:${String(value.totalMs)}`)
    .with('error', (value) => `error:${value.sessionId ?? 'none'}:${value.error.message}`)
    .exhaustive()
}

function TranscriptRows({
  rows,
  context,
}: {
  readonly rows: ChatRow[]
  readonly context: ChatRowRenderContext
}) {
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
            <ChatRowRenderer row={row} context={context} />
          </div>
        )
      })}
    </>
  )
}

function TranscriptExtensionCards({
  activeSessionId,
  extensionRegistry,
  extensionProjectPaths,
  rowsLength,
}: {
  readonly activeSessionId: SessionId | null
  readonly extensionRegistry: ExtensionContributionRegistryView | null
  readonly extensionProjectPaths: readonly string[]
  readonly rowsLength: number
}) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-12 pb-6">
      <ExtensionAgentLoopSurface
        fallback={null}
        input={{
          surface: 'transcript',
          transcript: {
            sessionId: activeSessionId ? String(activeSessionId) : null,
            projectPaths: extensionProjectPaths,
            messageCount: rowsLength,
            state: rowsLength > 0 ? 'active' : 'empty',
          },
        }}
        projectPaths={extensionProjectPaths}
        registry={extensionRegistry}
      />
    </div>
  )
}

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
    extensionRegistry,
    extensionProjectPaths,
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

  const rowContext: ChatRowRenderContext = {
    runtime: {
      sessionId: activeSessionId,
      extensions: { registry: extensionRegistry, projectPaths: extensionProjectPaths },
    },
    extensions: { registry: extensionRegistry, projectPaths: extensionProjectPaths },
    actions: { onBranchFromMessage, onForkFromMessage },
    onOpenSettings,
    onRetry: (content) => {
      void onRetryText(content)
    },
    onDismissError,
    onDismissInterruptedRun,
  }

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

  const scrollerProps = {
    role: 'log',
    'aria-label': 'Chat messages',
    'aria-busy': isLoading,
    className: cn(
      'flex flex-1 flex-col overflow-y-auto chat-scroll [overflow-anchor:none]',
      showScrollbar && 'is-scrolling',
    ),
    onScroll: handleScroll,
    onWheel: handleWheel,
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchEnd,
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div ref={scrollerRef} {...scrollerProps}>
        <div ref={contentRef} className="flex min-h-full flex-col">
          <TranscriptRows rows={rows} context={rowContext} />
          <TranscriptExtensionCards
            activeSessionId={activeSessionId}
            extensionRegistry={extensionRegistry}
            extensionProjectPaths={extensionProjectPaths}
            rowsLength={rows.length}
          />
        </div>
      </div>

      <ScrollToBottomButton visible={showScrollToBottom} onClick={scrollToBottom} />
    </div>
  )
}
