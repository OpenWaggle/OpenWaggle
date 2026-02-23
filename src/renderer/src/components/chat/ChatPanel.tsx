import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { QuestionAnswer, UserQuestion } from '@shared/types/question'
import { askUserArgsSchema } from '@shared/types/question'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { UIMessage } from '@tanstack/ai-react'
import { useState } from 'react'
import { Composer } from '@/components/composer/Composer'
import { Spinner } from '@/components/shared/Spinner'
import { formatElapsed, useStreamingPhase } from '@/hooks/useStreamingPhase'
import { ApprovalBanner } from './ApprovalBanner'
import { AskUserBlock } from './AskUserBlock'
import { ChatErrorDisplay } from './ChatErrorDisplay'
import { MessageBubble } from './MessageBubble'
import { RunSummary } from './RunSummary'
import type { OrchestrationProps } from './types'
import { useAutoScroll } from './useAutoScroll'
import { WelcomeScreen } from './WelcomeScreen'

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
  slashSkills: readonly SkillDiscoveryItem[]
  orchestration: OrchestrationProps
  recentProjects: readonly string[]
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
  slashSkills,
  orchestration,
  recentProjects,
}: ChatPanelProps): React.JSX.Element {
  const [dismissedError, setDismissedError] = useState<string | null>(null)

  const lastMsg = messages[messages.length - 1]
  const lastIsStreaming = isLoading && lastMsg?.role === 'assistant'

  const { scrollRef, handleScroll } = useAutoScroll({
    enabled: !!conversationId && messages.length > 0,
    skipWhileStreaming: lastIsStreaming,
  })

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserMessage =
    lastUserMsg?.parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.content)
      .join('\n') ?? null

  const { orchestrationRuns = [] } = orchestration

  const hasStreamingContent =
    !!lastMsg &&
    lastMsg.role === 'assistant' &&
    lastMsg.parts.some((p) => p.type === 'text' && p.content.trim())

  const phase = useStreamingPhase(isLoading, orchestrationRuns, hasStreamingContent)

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
          try {
            const parsed: unknown = JSON.parse(part.arguments)
            const result = askUserArgsSchema.safeParse(parsed)
            pendingAskUser = { questions: result.success ? result.data.questions : [] }
          } catch {
            pendingAskUser = { questions: [] }
          }
          break
        }
      }
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg overflow-hidden">
      {/* Scroll container — full width so scrollbar sits at right edge */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto chat-scroll">
        {messages.length === 0 && !isLoading ? (
          <WelcomeScreen
            projectPath={projectPath}
            hasProject={hasProject}
            recentProjects={recentProjects}
            onOpenProject={onOpenProject}
            onSelectProjectPath={onSelectProjectPath}
            onRetry={onRetry}
          />
        ) : (
          /* Messages list — centered, gap 24 between message groups */
          <div className="mx-auto w-full max-w-[720px] px-12 py-5">
            <div className="flex flex-col gap-6 w-full">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={lastIsStreaming && i === messages.length - 1}
                  assistantModel={
                    msg.role === 'assistant' ? (messageModelLookup[msg.id] ?? model) : undefined
                  }
                  conversationId={conversationId}
                  onAnswerQuestion={onAnswerQuestion}
                />
              ))}

              {/* Phase indicator — visible whenever the agent is running */}
              {phase.current && (
                <div className="flex items-center gap-2 py-3">
                  <Spinner size="sm" className="text-accent" />
                  <span className="text-sm text-text-tertiary">{phase.current.label}...</span>
                  <span className="text-sm text-text-muted tabular-nums">
                    {formatElapsed(phase.current.elapsedMs)}
                  </span>
                </div>
              )}

              {/* Run summary — shown after run completes */}
              {!isLoading && phase.completed.length > 0 && (
                <RunSummary phases={phase.completed} totalMs={phase.totalElapsedMs} />
              )}

              {error && !isLoading && (
                <ChatErrorDisplay
                  error={error}
                  lastUserMessage={lastUserMessage}
                  dismissedError={dismissedError}
                  conversationId={conversationId ? String(conversationId) : null}
                  onDismiss={setDismissedError}
                  onOpenSettings={onOpenSettings}
                  onRetry={onRetry}
                />
              )}
            </div>
          </div>
        )}
      </div>

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

      {/* Chat input card — centered to match content width */}
      <div className="mx-auto w-full max-w-[720px] px-5 pb-5">
        <Composer
          onSend={onSend}
          onCancel={onCancel}
          isLoading={isLoading}
          slashSkills={slashSkills}
          onToast={onToast}
        />
      </div>
    </div>
  )
}
