import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import { useEffect, useRef } from 'react'
import { useMessageQueueStore } from '@/stores/message-queue-store'

interface UseAutoSendQueueOptions {
  conversationId: ConversationId | null
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  sendMessage: (payload: AgentSendPayload) => Promise<void>
  paused?: boolean
}

/**
 * Watches agent status transitions and auto-dequeues messages when the agent
 * transitions from a non-ready state to 'ready'. Does NOT fire on initial mount
 * when status is already 'ready', and does NOT fire on 'error' transitions.
 *
 * When `paused` is true the hook skips firing AND preserves the previous status
 * so the non-ready → ready transition is still detected once unpaused.
 */
export function useAutoSendQueue({
  conversationId,
  status,
  sendMessage,
  paused = false,
}: UseAutoSendQueueOptions): void {
  const prevStatusRef = useRef(status)
  const sendMessageRef = useRef(sendMessage)
  useEffect(() => {
    sendMessageRef.current = sendMessage
  })

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

    sendMessageRef.current(item.payload).catch(() => {
      // Re-enqueue so the message isn't silently lost on send failure
      useMessageQueueStore.getState().enqueue(conversationId, item.payload)
    })
  }, [status, conversationId, paused])
}
