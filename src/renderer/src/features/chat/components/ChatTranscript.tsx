import type { SessionId } from '@shared/types/brand'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import { ExtensionAgentLoopSurface } from '@/features/extensions'
import { cn } from '@/shared/lib/cn'
import { useChatScrollBehaviour } from '../hooks/useChatScrollBehaviour'
import type { ChatTranscriptSectionState } from '../model'
import type { ChatRowRenderContext } from './ChatRowRenderContext'
import { ScrollToBottomButton } from './ScrollToBottomButton'
import { TranscriptWindow } from './TranscriptWindow'
import { WelcomeScreen } from './WelcomeScreen'

interface ChatTranscriptProps {
  readonly section: ChatTranscriptSectionState
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

/** The per-row render context, assembled outside the component to keep it readable. */
function buildRowContext({
  activeSessionId,
  extensionRegistry,
  extensionProjectPaths,
  onBranchFromMessage,
  onForkFromMessage,
  onViewTurnDiff,
  turnAnchorMessageIds,
  onOpenSettings,
  onRetryText,
  onDismissError,
  onDismissInterruptedRun,
}: Pick<
  ChatTranscriptSectionState,
  | 'activeSessionId'
  | 'extensionRegistry'
  | 'extensionProjectPaths'
  | 'onBranchFromMessage'
  | 'onForkFromMessage'
  | 'onViewTurnDiff'
  | 'turnAnchorMessageIds'
  | 'onOpenSettings'
  | 'onRetryText'
  | 'onDismissError'
  | 'onDismissInterruptedRun'
>): ChatRowRenderContext {
  const extensions = { registry: extensionRegistry, projectPaths: extensionProjectPaths }
  return {
    runtime: { sessionId: activeSessionId, extensions },
    extensions,
    actions: { onBranchFromMessage, onForkFromMessage, onViewTurnDiff, turnAnchorMessageIds },
    onOpenSettings,
    onRetry: (content) => {
      void onRetryText(content)
    },
    onDismissError,
    onDismissInterruptedRun,
  }
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

  const rowContext = buildRowContext(section)

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
          {/*
           * Keyed by session so the window resets to the newest rows on a switch. The scroller
           * above keeps its identity, because its scroll position and refs must survive.
           */}
          <TranscriptWindow
            key={activeSessionId ? String(activeSessionId) : 'none'}
            rows={rows}
            context={rowContext}
          />
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
