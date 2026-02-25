import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type {
  AgentColor,
  MultiAgentConfig,
  MultiAgentMessageMetadata,
} from '@shared/types/multi-agent'
import type { QuestionAnswer, UserQuestion } from '@shared/types/question'
import { askUserArgsSchema } from '@shared/types/question'
import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { UIMessage } from '@tanstack/ai-react'
import { useState } from 'react'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { Composer } from '@/components/composer/Composer'
import { CollaborationStatus } from '@/components/multi-agent/CollaborationStatus'
import { TurnDivider } from '@/components/multi-agent/TurnDivider'
import { Spinner } from '@/components/shared/Spinner'
import { formatElapsed, useStreamingPhase } from '@/hooks/useStreamingPhase'
import { useComposerStore } from '@/stores/composer-store'
import { useUIStore } from '@/stores/ui-store'
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
  multiAgentMetadataLookup: Readonly<Record<string, MultiAgentMessageMetadata>>
  slashSkills: readonly SkillDiscoveryItem[]
  orchestration: OrchestrationProps
  recentProjects: readonly string[]
  onStopCollaboration?: () => void
  onStartCowork: (config: MultiAgentConfig) => void
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
  onStartCowork,
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
              {messages.map((msg, i) => {
                const meta = multiAgentMetadataLookup[msg.id]

                // During streaming, a multi-agent message contains synthetic
                // _turnBoundary tool-call parts that separate each turn's content.
                // Split them into per-turn visual segments so each renders as its
                // own bubble with the correct agent label/color.
                const hasTurnBoundaries =
                  msg.role === 'assistant' &&
                  msg.parts.some((p) => p.type === 'tool-call' && p.name === '_turnBoundary')

                if (hasTurnBoundaries) {
                  const segments = splitAtTurnBoundaries(msg, meta)
                  return segments.map((seg, segIdx) => {
                    const segMeta = seg.meta
                    const prevSegMeta = segIdx > 0 ? segments[segIdx - 1].meta : undefined
                    const showDivider =
                      segMeta && segIdx > 0 && prevSegMeta?.agentIndex !== segMeta.agentIndex

                    return (
                      <div key={seg.id} className="flex flex-col gap-6">
                        {showDivider && segMeta && (
                          <TurnDivider
                            turnNumber={segMeta.turnNumber}
                            agentLabel={segMeta.agentLabel}
                            agentColor={segMeta.agentColor}
                            isSynthesis={segMeta.isSynthesis}
                          />
                        )}
                        <MessageBubble
                          message={{ ...msg, id: seg.id, parts: seg.parts }}
                          isStreaming={
                            lastIsStreaming &&
                            i === messages.length - 1 &&
                            segIdx === segments.length - 1
                          }
                          assistantModel={segMeta?.agentModel ?? model}
                          conversationId={conversationId}
                          onAnswerQuestion={onAnswerQuestion}
                          multiAgent={
                            segMeta
                              ? { agentLabel: segMeta.agentLabel, agentColor: segMeta.agentColor }
                              : undefined
                          }
                        />
                      </div>
                    )
                  })
                }

                const prevMeta = i > 0 ? multiAgentMetadataLookup[messages[i - 1].id] : undefined

                // Show a turn divider when the agent changes between assistant messages
                const showTurnDivider =
                  meta &&
                  msg.role === 'assistant' &&
                  (!prevMeta || prevMeta.agentIndex !== meta.agentIndex)

                return (
                  <div key={msg.id} className="flex flex-col gap-6">
                    {showTurnDivider && (
                      <TurnDivider
                        turnNumber={meta.turnNumber}
                        agentLabel={meta.agentLabel}
                        agentColor={meta.agentColor}
                        isSynthesis={meta.isSynthesis}
                      />
                    )}
                    <MessageBubble
                      message={msg}
                      isStreaming={lastIsStreaming && i === messages.length - 1}
                      assistantModel={
                        msg.role === 'assistant'
                          ? (meta?.agentModel ?? messageModelLookup[msg.id] ?? model)
                          : undefined
                      }
                      conversationId={conversationId}
                      onAnswerQuestion={onAnswerQuestion}
                      multiAgent={
                        meta
                          ? { agentLabel: meta.agentLabel, agentColor: meta.agentColor }
                          : undefined
                      }
                    />
                  </div>
                )
              })}

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

      {/* Multi-agent collaboration status (armed + running states) */}
      <CollaborationStatus onStop={onStopCollaboration ?? (() => {})} />

      {/* Command palette — above composer */}
      {commandPaletteOpen && (
        <div className="mx-auto w-full max-w-[720px] px-5 pb-2">
          <CommandPalette
            slashSkills={slashSkills}
            onSelectSkill={handleSkillSelect}
            onStartCowork={onStartCowork}
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

// ─── Multi-agent streaming helpers ──────────────────────────────

interface TurnSegment {
  id: string
  parts: UIMessage['parts']
  meta: MultiAgentMessageMetadata | undefined
}

/**
 * Parse agent metadata from a _turnBoundary tool call's output.
 * The StreamProcessor parses the JSON result string into an object,
 * so `output` is typically already an object. Handle both cases.
 */
function parseBoundaryMeta(output: unknown): MultiAgentMessageMetadata | undefined {
  let obj: unknown = output
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return undefined
    }
  }
  if (obj && typeof obj === 'object' && 'agentIndex' in obj) {
    const p = obj as Record<string, unknown>
    return {
      agentIndex: p.agentIndex as number,
      agentLabel: p.agentLabel as string,
      agentColor: p.agentColor as AgentColor,
      agentModel: p.agentModel as SupportedModelId,
      turnNumber: p.turnNumber as number,
      ...(p.isSynthesis === true ? { isSynthesis: true } : {}),
    }
  }
  return undefined
}

/**
 * Split a single streaming UIMessage at _turnBoundary tool-call parts.
 * Returns one segment per turn, each with its own parts and agent metadata.
 */
function splitAtTurnBoundaries(
  msg: UIMessage,
  firstTurnMeta: MultiAgentMessageMetadata | undefined,
): TurnSegment[] {
  const segments: TurnSegment[] = []
  let currentParts: UIMessage['parts'] = []
  let currentMeta = firstTurnMeta
  let turnIndex = 0

  for (const part of msg.parts) {
    if (part.type === 'tool-call' && part.name === '_turnBoundary') {
      // Flush current segment
      segments.push({
        id: `${msg.id}-turn-${String(turnIndex)}`,
        parts: currentParts,
        meta: currentMeta,
      })

      // Extract metadata for the next turn from the boundary's output
      currentMeta = parseBoundaryMeta(part.output) ?? currentMeta
      turnIndex++
      currentParts = []
      continue
    }

    // Skip tool-result parts for _turnBoundary (shouldn't exist, but guard)
    if (
      part.type === 'tool-result' &&
      msg.parts.some(
        (p) => p.type === 'tool-call' && p.name === '_turnBoundary' && p.id === part.toolCallId,
      )
    ) {
      continue
    }

    currentParts.push(part)
  }

  // Flush the final segment (may be empty if still streaming)
  if (currentParts.length > 0 || turnIndex > 0) {
    segments.push({
      id: `${msg.id}-turn-${String(turnIndex)}`,
      parts: currentParts,
      meta: currentMeta,
    })
  }

  return segments
}
