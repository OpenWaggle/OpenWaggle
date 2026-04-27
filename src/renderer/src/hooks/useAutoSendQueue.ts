import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import { useEffect, useRef } from 'react'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import type { AgentChatStatus } from './useAgentChat'

interface UseAutoSendQueueOptions {
  conversationId: ConversationId | null
  status: AgentChatStatus
  sendMessage: (payload: AgentSendPayload) => Promise<void>
  paused?: boolean
  onSendFailure?: (payload: AgentSendPayload, error: unknown) => void
}

/**
 * Watches agent status transitions and handles queued messages:
 *
 * 1. When the agent transitions from non-ready to 'ready', auto-dequeues and
 *    sends the next message as a new turn.
 *
 * When `paused` is true the hook skips firing AND preserves the previous status
 * so the non-ready → ready transition is still detected once unpaused.
 */
export function useAutoSendQueue({
  conversationId,
  status,
  sendMessage,
  paused = false,
  onSendFailure,
}: UseAutoSendQueueOptions): void {
  const prevStatusRef = useRef(status)
  const sendMessageRef = useRef(sendMessage)
  const onSendFailureRef = useRef(onSendFailure)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  })
  useEffect(() => {
    onSendFailureRef.current = onSendFailure
  }, [onSendFailure])

  // Path 1: non-ready → ready transition → auto-send next queued message as new turn
  useEffect(() => {
    const prevStatus = prevStatusRef.current

    // While paused, don't update prevStatus — preserve the pre-pause value
    // so we detect the transition correctly once unpaused.
    if (paused) return

    prevStatusRef.current = status

    if (status !== 'ready') return
    if (prevStatus === 'ready') return
    if (!conversationId) return

    const item = useMessageQueueStore.getState().dequeue(conversationId)
    if (!item) return

    const reportSendFailure = onSendFailureRef.current
    sendMessageRef.current(item.payload).catch((error: unknown) => {
      // Re-enqueue so the message isn't silently lost on send failure
      useMessageQueueStore.getState().enqueue(conversationId, item.payload)
      reportSendFailure?.(item.payload, error)
    })
  }, [status, conversationId, paused])
}
