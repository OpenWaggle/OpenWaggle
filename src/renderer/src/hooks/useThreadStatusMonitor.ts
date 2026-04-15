import type { ConversationId } from '@shared/types/brand'
import type { CompactionStage } from '@shared/types/compaction'
import { TERMINAL_STATUSES, type ThreadStatus } from '@shared/types/thread-status'
import { useEffect } from 'react'
import { api } from '@/lib/ipc'
import { isTerminalChunk } from '@/lib/ipc-connection-adapter'
import { useChatStore } from '@/stores/chat-store'
import { useCompactionStore } from '@/stores/compaction-store'
import { useThreadStatusStore } from '@/stores/thread-status-store'

/** Set of conversation IDs that are currently in a waggle run. */
const activeWaggleConversations = new Set<ConversationId>()

const VALID_COMPACTION_STAGES: ReadonlySet<string> = new Set([
  'starting',
  'summarizing',
  'completed',
  'failed',
] as const satisfies readonly CompactionStage[])

/** Type guard for compaction event values received via CUSTOM stream chunks. */
function isCompactionEvent(value: unknown): value is {
  stage: CompactionStage
  description?: string
  errorMessage?: string
  metrics?: { tokensBefore: number; tokensAfter: number; messagesSummarized: number }
} {
  if (typeof value !== 'object' || value === null) return false
  if (!('stage' in value)) return false
  const { stage } = value
  if (typeof stage !== 'string') return false
  if (!VALID_COMPACTION_STAGES.has(stage)) return false

  // Validate metrics shape when present to prevent NaN propagation downstream
  if ('metrics' in value && value.metrics != null) {
    const m = value.metrics
    if (typeof m !== 'object' || m === null) return false
    if (!('tokensBefore' in m) || typeof m.tokensBefore !== 'number') return false
    if (!('tokensAfter' in m) || typeof m.tokensAfter !== 'number') return false
    if (!('messagesSummarized' in m) || typeof m.messagesSummarized !== 'number') return false
  }

  return true
}

/**
 * Subscribes to agent lifecycle events and maintains per-thread status
 * in the thread-status store. Mounted once at workspace level.
 *
 * When a terminal status arrives for the currently active thread,
 * it is immediately marked as visited so the icon doesn't flash.
 */
export function useThreadStatusMonitor(): void {
  const setStatus = useThreadStatusStore((s) => s.setStatus)
  const markVisited = useThreadStatusStore((s) => s.markVisited)
  const setCompactionStatus = useCompactionStore((s) => s.setStatus)

  useEffect(() => {
    function setStatusWithVisitCheck(conversationId: ConversationId, status: ThreadStatus): void {
      setStatus(conversationId, status)
      // If the user is currently viewing this thread and it's a terminal status, auto-mark visited
      if (TERMINAL_STATUSES.has(status)) {
        const activeId = useChatStore.getState().activeConversationId
        if (conversationId === activeId) {
          markVisited(conversationId)
        }
      }
    }

    const unsubPhase = api.onAgentPhase(({ conversationId, phase }) => {
      if (!phase) return
      // Don't downgrade waggle-running to working
      if (activeWaggleConversations.has(conversationId)) return
      setStatusWithVisitCheck(conversationId, 'working')
    })

    const unsubCompleted = api.onRunCompleted(({ conversationId }) => {
      activeWaggleConversations.delete(conversationId)
      setStatusWithVisitCheck(conversationId, 'completed')
    })

    const unsubQuestion = api.onQuestion(({ conversationId }) => {
      setStatusWithVisitCheck(conversationId, 'awaiting-input')
    })

    const unsubPlan = api.onPlanProposal(({ conversationId }) => {
      setStatusWithVisitCheck(conversationId, 'plan-ready')
    })

    const unsubWaggleTurn = api.onWaggleTurnEvent(({ conversationId, event }) => {
      if (event.type === 'turn-start' || event.type === 'synthesis-start') {
        activeWaggleConversations.add(conversationId)
        setStatusWithVisitCheck(conversationId, 'waggle-running')
      }
      // Terminal waggle events: RUN_FINISHED from the envelope handler will
      // transition to 'completed' via onRunCompleted above.
    })

    const unsubChunk = api.onStreamChunk(({ conversationId, chunk }) => {
      if (chunk.type === 'RUN_STARTED') {
        if (activeWaggleConversations.has(conversationId)) return
        setStatusWithVisitCheck(conversationId, 'connecting')
        return
      }
      if (chunk.type === 'RUN_ERROR') {
        setStatusWithVisitCheck(conversationId, 'error')
        return
      }
      if (chunk.type === 'CUSTOM' && chunk.name === 'approval-requested') {
        setStatusWithVisitCheck(conversationId, 'pending-approval')
        return
      }
      if (chunk.type === 'CUSTOM' && chunk.name === 'compaction') {
        const event = chunk.value
        if (isCompactionEvent(event)) {
          setCompactionStatus(conversationId, {
            stage: event.stage,
            description: event.description ?? '',
            errorMessage: event.errorMessage,
            metrics: event.metrics,
            updatedAt: Date.now(),
          })
        }
        return
      }
      if (chunk.type === 'TEXT_MESSAGE_CONTENT' || chunk.type === 'TOOL_CALL_START') {
        // Don't downgrade waggle-running to working from regular stream chunks
        if (activeWaggleConversations.has(conversationId)) return
        setStatusWithVisitCheck(conversationId, 'working')
        return
      }
      if (isTerminalChunk(chunk)) {
        setStatusWithVisitCheck(conversationId, 'completed')
      }
    })

    return () => {
      unsubPhase()
      unsubCompleted()
      unsubQuestion()
      unsubPlan()
      unsubWaggleTurn()
      unsubChunk()
    }
  }, [setStatus, markVisited, setCompactionStatus])
}
