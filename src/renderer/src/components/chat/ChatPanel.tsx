import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId, SupportedModelId } from '@shared/types/brand'
import type { MultiAgentConfig, MultiAgentMessageMetadata } from '@shared/types/multi-agent'
import type { QuestionAnswer, UserQuestion } from '@shared/types/question'
import { askUserArgsSchema } from '@shared/types/question'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { UIMessage } from '@tanstack/ai-react'
import { useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { Composer } from '@/components/composer/Composer'
import { CollaborationStatus } from '@/components/multi-agent/CollaborationStatus'
import { useStreamingPhase } from '@/hooks/useStreamingPhase'
import { cn } from '@/lib/cn'
import { useComposerStore } from '@/stores/composer-store'
import { useUIStore } from '@/stores/ui-store'
import { ApprovalBanner } from './ApprovalBanner'
import { AskUserBlock } from './AskUserBlock'
import type { OrchestrationProps } from './types'
import type { VirtualRow } from './types-virtual'
import { buildVirtualRows } from './useVirtualRows'
import { VirtualRowRenderer } from './VirtualRowRenderer'
import { WelcomeScreen } from './WelcomeScreen'

// ─── Custom Scroller ────────────────────────────────────────────

/** Custom Virtuoso scroller that adds the chat-scroll class and is-scrolling timer. */
function ChatScroller(props: React.ComponentPropsWithRef<'div'>): React.JSX.Element {
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  function handleScroll(e: React.UIEvent<HTMLDivElement>): void {
    const el = e.currentTarget
    el.classList.add('is-scrolling')
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      el.classList.remove('is-scrolling')
    }, 1200)
    // Forward the original onScroll if Virtuoso provided one
    props.onScroll?.(e)
  }

  return <div {...props} onScroll={handleScroll} className={cn(props.className, 'chat-scroll')} />
}

// ─── ChatPanel ──────────────────────────────────────────────────

interface ChatPanelProps {
  messages: UIMessage[]
  isLoading: boolean
  error: Error | undefined
  projectPath: string | null
  hasProject: boolean
  conversationId: ConversationId | null
  onOpenProject?: () => void
  onSelectProjectPath?: (path: string) => Promise<void> | void
  onOpenSettings?: () => void
  onRetry?: (content: string) => void
  onSend: (payload: AgentSendPayload) => void
  onToast?: (message: string) => void
  onCancel: () => void
  onToolApprovalResponse: (approvalId: string, approved: boolean) => Promise<void>
  onAnswerQuestion: (conversationId: ConversationId, answers: QuestionAnswer[]) => Promise<void>
  model: SupportedModelId
  messageModelLookup: Readonly<Record<string, SupportedModelId>>
  multiAgentMetadataLookup: Readonly<Record<string, MultiAgentMessageMetadata>>
  slashSkills: readonly SkillDiscoveryItem[]
  orchestration: OrchestrationProps
  recentProjects: readonly string[]
  onStopCollaboration?: () => void
  onStartWaggle: (config: MultiAgentConfig) => void
}

function parseAskUserQuestions(args: string): UserQuestion[] {
  try {
    const parsed: unknown = JSON.parse(args)
    const result = askUserArgsSchema.safeParse(parsed)
    if (result.success) {
      return result.data.questions
    }
  } catch {}
  return []
}

export function ChatPanel({
  messages,
  isLoading,
  error,
  projectPath,
  hasProject,
  conversationId,
  onOpenProject,
  onSelectProjectPath,
  onOpenSettings,
  onRetry,
  onSend,
  onToast,
  onCancel,
  onToolApprovalResponse,
  onAnswerQuestion,
  model,
  messageModelLookup,
  multiAgentMetadataLookup,
  slashSkills,
  orchestration,
  recentProjects,
  onStopCollaboration,
  onStartWaggle,
}: ChatPanelProps): React.JSX.Element {
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen)

  function handleSkillSelect(skillId: string): void {
    const store = useComposerStore.getState()
    const currentInput = store.input
    // If the user typed "/" to open the palette, replace it; otherwise prepend
    const newInput = currentInput === '/' ? `/${skillId} ` : `/${skillId} ${currentInput}`
    store.setInput(newInput)
    store.setCursorIndex(newInput.length)
  }
  const [dismissedError, setDismissedError] = useState<string | null>(null)

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserMessage =
    lastUserMsg?.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.content)
      .join('\n') ?? null

  const { orchestrationRuns = [] } = orchestration

  const lastMsg = messages[messages.length - 1]
  const hasStreamingContent =
    !!lastMsg &&
    lastMsg.role === 'assistant' &&
    lastMsg.parts.some((p) => p.type === 'text' && p.content.trim())

  const phase = useStreamingPhase(isLoading, orchestrationRuns, hasStreamingContent)

  const virtualRows = buildVirtualRows({
    messages,
    isLoading,
    error,
    lastUserMessage,
    dismissedError,
    conversationId: conversationId ? String(conversationId) : null,
    model,
    messageModelLookup,
    multiAgentMetadataLookup,
    phase,
  })

  // Find the first pending tool approval across all messages
  let pendingApproval: {
    toolName: string
    toolArgs: string
    approvalId: string
  } | null = null
  for (const msg of messages) {
    if (pendingApproval) break
    for (const part of msg.parts) {
      if (part.type === 'tool-call' && part.state === 'approval-requested' && part.approval?.id) {
        pendingApproval = {
          toolName: part.name,
          toolArgs: part.arguments,
          approvalId: part.approval.id,
        }
        break
      }
    }
  }

  // Find pending askUser tool call (unanswered)
  let pendingAskUser: {
    questions: UserQuestion[]
  } | null = null
  for (const msg of messages) {
    if (pendingAskUser) break
    for (const part of msg.parts) {
      if (part.type === 'tool-call' && part.name === 'askUser') {
        // Check if there's a matching result
        const hasResult = msg.parts.some(
          (p) => p.type === 'tool-result' && p.toolCallId === part.id,
        )
        if (!hasResult) {
          pendingAskUser = { questions: parseAskUserQuestions(part.arguments) }
          break
        }
      }
    }
  }

  function renderRow(_index: number, row: VirtualRow): React.JSX.Element {
    return (
      <div
        className="mx-auto w-full max-w-[720px] px-12 pb-6"
        style={_index === 0 ? { paddingTop: 20 } : undefined}
      >
        <VirtualRowRenderer
          row={row}
          conversationId={conversationId}
          onAnswerQuestion={onAnswerQuestion}
          onOpenSettings={onOpenSettings}
          onRetry={onRetry}
          onDismissError={setDismissedError}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg overflow-hidden">
      {messages.length === 0 && !isLoading ? (
        <div className="flex-1 overflow-y-auto chat-scroll">
          <WelcomeScreen
            projectPath={projectPath}
            hasProject={hasProject}
            recentProjects={recentProjects}
            onOpenProject={onOpenProject}
            onSelectProjectPath={onSelectProjectPath}
            onRetry={onRetry}
          />
        </div>
      ) : (
        <Virtuoso
          key={conversationId ?? 'empty'}
          data={virtualRows}
          followOutput="smooth"
          initialTopMostItemIndex={Math.max(0, virtualRows.length - 1)}
          overscan={800}
          className="flex-1"
          components={{ Scroller: ChatScroller }}
          itemContent={renderRow}
        />
      )}

      {/* Pinned approval banner — always visible above composer */}
      {pendingApproval && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <ApprovalBanner
            toolName={pendingApproval.toolName}
            toolArgs={pendingApproval.toolArgs}
            approvalId={pendingApproval.approvalId}
            onApprovalResponse={onToolApprovalResponse}
          />
        </div>
      )}

      {/* Pinned askUser block — above composer */}
      {pendingAskUser && conversationId && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <AskUserBlock
            questions={pendingAskUser.questions}
            conversationId={conversationId}
            onAnswer={onAnswerQuestion}
          />
        </div>
      )}

      {/* Multi-agent collaboration status (armed + running states) */}
      <CollaborationStatus onStop={onStopCollaboration ?? (() => {})} />

      {/* Command palette — above composer */}
      {commandPaletteOpen && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <CommandPalette
            slashSkills={slashSkills}
            onSelectSkill={handleSkillSelect}
            onStartWaggle={onStartWaggle}
          />
        </div>
      )}

      {/* Chat input card — centered to match content width */}
      <div className="mx-auto w-full max-w-[720px] px-5 pb-5">
        <Composer onSend={onSend} onCancel={onCancel} isLoading={isLoading} onToast={onToast} />
      </div>
    </div>
  )
}
