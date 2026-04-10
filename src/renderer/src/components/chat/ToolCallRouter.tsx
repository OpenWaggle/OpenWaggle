import type { ConversationId } from '@shared/types/brand'
import type { OrchestrationTaskStatus } from '@shared/types/orchestration'
import type { PlanResponse } from '@shared/types/plan'
import type { UIMessage } from '@tanstack/ai-react'
import { Check, ClipboardList } from 'lucide-react'
import type { TaskLiveStatus } from '@/hooks/useOrchestrationTaskStatus'
import {
  countQuestions,
  parseOrchestrateTasks,
  parsePlanAction,
  parsePlanText,
} from './message-bubble-utils'
import { PlanCard } from './PlanCard'
import { SubAgentGroup } from './SubAgentGroup'
import { ToolCallBlock } from './ToolCallBlock'

interface ToolCallRouterProps {
  part: Extract<UIMessage['parts'][number], { type: 'tool-call' }>
  toolResults: Map<string, { content: unknown; state: string; error?: string }>
  conversationId: ConversationId | null
  onRespondToPlan?: (conversationId: ConversationId, response: PlanResponse) => Promise<void>
  isStreaming: boolean
  taskStatusLookup?: (taskId: string) => TaskLiveStatus | undefined
}

export function ToolCallRouter({
  part,
  toolResults,
  conversationId,
  onRespondToPlan,
  isStreaming,
  taskStatusLookup,
}: ToolCallRouterProps) {
  // Synthetic turn-boundary markers are only structural separators
  // for Waggle streaming — never render them as tool calls.
  if (part.name === '_turnBoundary') return null

  if (part.name === 'askUser') {
    const result = toolResults.get(part.id)
    if (result) {
      // Answered — show compact muted summary
      const questionCount = countQuestions(part.arguments)
      return (
        <div className="flex items-center gap-2 py-0.5 text-[13px]">
          <Check className="h-3.5 w-3.5 text-text-muted shrink-0" />
          <span className="text-text-muted">
            Answered {questionCount} {questionCount === 1 ? 'question' : 'questions'}
          </span>
        </div>
      )
    }
    // Unanswered — render nothing inline (active prompt renders above composer)
    return null
  }

  if (part.name === 'proposePlan' && conversationId && onRespondToPlan) {
    const planText = parsePlanText(part.arguments)
    const result = toolResults.get(part.id)
    const isToolStreaming = !result && part.state !== 'input-complete' && isStreaming
    if (result) {
      // Answered — show compact inline summary
      const action = parsePlanAction(result.content)
      return (
        <div className="flex items-center gap-2 py-0.5 text-[13px]">
          <ClipboardList className="h-3.5 w-3.5 text-text-muted shrink-0" />
          <span className="text-text-muted">
            Plan {action === 'approve' ? 'approved' : 'revised'}
          </span>
        </div>
      )
    }
    return (
      <PlanCard
        planText={planText}
        conversationId={conversationId}
        isStreaming={isToolStreaming}
        onRespond={onRespondToPlan}
      />
    )
  }

  if (part.name === 'orchestrate') {
    const result = toolResults.get(part.id)
    const tasks = parseOrchestrateTasks(part.arguments)
    const hasToolError = result?.state === 'error' || !!result?.error
    const fallbackStatus: OrchestrationTaskStatus = result
      ? hasToolError
        ? 'failed'
        : 'completed'
      : isStreaming
        ? 'running'
        : 'cancelled'
    const isComplete = !!result || !isStreaming
    return (
      <SubAgentGroup
        tasks={tasks.map((t) => {
          const live = taskStatusLookup?.(t.id)
          if (live) {
            return { ...t, status: live.status, output: live.output, error: live.error }
          }
          return { ...t, status: fallbackStatus }
        })}
        isComplete={isComplete}
      />
    )
  }

  return (
    <ToolCallBlock
      name={part.name}
      args={part.arguments}
      state={part.state}
      result={toolResults.get(part.id)}
      isStreaming={isStreaming}
    />
  )
}
