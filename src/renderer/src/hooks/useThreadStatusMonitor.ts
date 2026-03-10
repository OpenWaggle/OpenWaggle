import type { ConversationId } from '@shared/types/brand'
import { TERMINAL_STATUSES, type ThreadStatus } from '@shared/types/thread-status'
import { useEffect } from 'react'
import { api } from '@/lib/ipc'
import { isTerminalChunk } from '@/lib/ipc-connection-adapter'
import { useChatStore } from '@/stores/chat-store'
import { useThreadStatusStore } from '@/stores/thread-status-store'

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
      setStatusWithVisitCheck(conversationId, 'working')
    })

    const unsubCompleted = api.onRunCompleted(({ conversationId }) => {
      setStatusWithVisitCheck(conversationId, 'completed')
    })

    const unsubQuestion = api.onQuestion(({ conversationId }) => {
      setStatusWithVisitCheck(conversationId, 'awaiting-input')
    })

    const unsubPlan = api.onPlanProposal(({ conversationId }) => {
      setStatusWithVisitCheck(conversationId, 'plan-ready')
    })

    const unsubChunk = api.onStreamChunk(({ conversationId, chunk }) => {
      if (chunk.type === 'RUN_STARTED') {
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
      if (chunk.type === 'TEXT_MESSAGE_CONTENT' || chunk.type === 'TOOL_CALL_START') {
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
      unsubChunk()
    }
  }, [setStatus, markVisited])
}
