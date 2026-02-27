import type { ConversationId } from '@shared/types/brand'
import type { QuestionAnswer } from '@shared/types/question'
import { useRef } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { cn } from '@/lib/cn'
import type { VirtualRow } from './types-virtual'
import type { ChatTranscriptSectionState } from './use-chat-panel-controller'
import { VirtualRowRenderer } from './VirtualRowRenderer'
import { WelcomeScreen } from './WelcomeScreen'

interface ChatTranscriptProps {
  readonly section: ChatTranscriptSectionState
}

function ChatScroller(props: React.ComponentPropsWithRef<'div'>): React.JSX.Element {
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  function handleScroll(event: React.UIEvent<HTMLDivElement>): void {
    const element = event.currentTarget
    element.classList.add('is-scrolling')
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current)
    }
    scrollTimerRef.current = setTimeout(() => {
      element.classList.remove('is-scrolling')
    }, 1200)
    props.onScroll?.(event)
  }

  return <div {...props} onScroll={handleScroll} className={cn(props.className, 'chat-scroll')} />
}

function renderTranscriptRow(
  row: VirtualRow,
  index: number,
  conversationId: ConversationId | null,
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>,
  onOpenSettings: () => void,
  onRetryText: (content: string) => Promise<void>,
  onDismissError: (errorId: string | null) => void,
): React.JSX.Element {
  return (
    <div
      className="mx-auto w-full max-w-[720px] px-12 pb-6"
      style={index === 0 ? { paddingTop: 20 } : undefined}
    >
      <VirtualRowRenderer
        row={row}
        conversationId={conversationId}
        onAnswerQuestion={onAnswerQuestion}
        onOpenSettings={onOpenSettings}
        onRetry={(content) => {
          void onRetryText(content)
        }}
        onDismissError={onDismissError}
      />
    </div>
  )
}

export function ChatTranscript({ section }: ChatTranscriptProps): React.JSX.Element {
  const {
    messages,
    isLoading,
    projectPath,
    recentProjects,
    activeConversationId,
    virtualRows,
    onOpenProject,
    onSelectProjectPath,
    onRetryText,
    onAnswerQuestion,
    onOpenSettings,
    onDismissError,
  } = section

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
      role="log"
      aria-label="Chat messages"
      aria-busy={isLoading}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <Virtuoso
        key={activeConversationId ?? 'empty'}
        data={virtualRows}
        followOutput="smooth"
        initialTopMostItemIndex={Math.max(0, virtualRows.length - 1)}
        overscan={800}
        className="flex-1"
        components={{ Scroller: ChatScroller }}
        itemContent={(index, row) =>
          renderTranscriptRow(
            row,
            index,
            activeConversationId,
            onAnswerQuestion,
            onOpenSettings,
            onRetryText,
            onDismissError,
          )
        }
      />
    </div>
  )
}
