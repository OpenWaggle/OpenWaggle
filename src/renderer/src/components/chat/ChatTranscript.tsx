import type { ConversationId } from '@shared/types/brand'
import type { PlanResponse } from '@shared/types/plan'
import type { QuestionAnswer } from '@shared/types/question'
import { chooseBy } from '@shared/utils/decision'
import { useRef } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { cn } from '@/lib/cn'
import type { VirtualRow } from './types-virtual'
import type { ChatTranscriptSectionState } from './use-chat-panel-controller'
import { VirtualRowRenderer } from './VirtualRowRenderer'
import { WelcomeScreen } from './WelcomeScreen'

const DELAY_MS = 1200
const PADDING_TOP = 20
const OVERSCAN = 800

interface ChatTranscriptProps {
  readonly section: ChatTranscriptSectionState
}

function resolveFollowOutput(isAtBottom: boolean, isLoading: boolean): 'auto' | 'smooth' | false {
  if (!isAtBottom) {
    return false
  }
  return isLoading ? 'auto' : 'smooth'
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
    }, DELAY_MS)
    props.onScroll?.(event)
  }

  return <div {...props} onScroll={handleScroll} className={cn(props.className, 'chat-scroll')} />
}

function renderTranscriptRow(
  row: VirtualRow,
  index: number,
  conversationId: ConversationId | null,
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>,
  onRespondToPlan: (conversationId: ConversationId, response: PlanResponse) => Promise<void>,
  onOpenSettings: () => void,
  onRetryText: (content: string) => Promise<void>,
  onDismissError: (errorId: string | null) => void,
): React.JSX.Element {
  return (
    <div
      className="mx-auto w-full max-w-[720px] px-12 pb-6"
      style={index === 0 ? { paddingTop: PADDING_TOP } : undefined}
    >
      <VirtualRowRenderer
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
    </div>
  )
}

function getVirtualRowKey(row: VirtualRow): string {
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
    virtualRows,
    onOpenProject,
    onSelectProjectPath,
    onRetryText,
    onAnswerQuestion,
    onRespondToPlan,
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
        computeItemKey={(_index, row) => getVirtualRowKey(row)}
        followOutput={(isAtBottom) => resolveFollowOutput(isAtBottom, isLoading)}
        initialTopMostItemIndex={Math.max(0, virtualRows.length - 1)}
        overscan={OVERSCAN}
        className="flex-1"
        components={{ Scroller: ChatScroller }}
        itemContent={(index, row) =>
          renderTranscriptRow(
            row,
            index,
            activeConversationId,
            onAnswerQuestion,
            onRespondToPlan,
            onOpenSettings,
            onRetryText,
            onDismissError,
          )
        }
      />
    </div>
  )
}
