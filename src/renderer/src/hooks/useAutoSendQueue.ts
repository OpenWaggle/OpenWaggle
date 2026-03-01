import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import { useEffect, useRef } from 'react'
import { api } from '@/lib/ipc'
import { useMessageQueueStore } from '@/stores/message-queue-store'

interface UseAutoSendQueueOptions {
  conversationId: ConversationId | null
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  sendMessage: (payload: AgentSendPayload) => Promise<void>
  paused?: boolean
}

/**
 * Watches agent status transitions and handles queued messages:
 *
 * 1. When the agent transitions from non-ready to 'ready', auto-dequeues and
 *    sends the next message as a new turn.
 *
 * 2. When the agent is 'streaming' and messages appear in the queue, forwards
 *    them to the main-process context injection buffer (via `api.injectContext`)
 *    so the agent reads them at the next tool boundary without stopping.
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

    sendMessageRef.current(item.payload).catch(() => {
      // Re-enqueue so the message isn't silently lost on send failure
      useMessageQueueStore.getState().enqueue(conversationId, item.payload)
    })
  }, [status, conversationId, paused])

  // Path 2: streaming → forward newly-queued messages to injection buffer.
  // Uses Zustand subscribe() to react to queue additions outside React's
  // render cycle, avoiding self-mutation loops (dismiss changes queue state).
  // Only forwards items added *after* the subscription starts — pre-existing
  // queue items are left for Path 1 to dequeue on the ready transition.
  useEffect(() => {
    if (status !== 'streaming' || !conversationId || paused) return

    const unsub = useMessageQueueStore.subscribe((state, prevState) => {
      const curr = state.queues.get(conversationId) ?? []
      const prev = prevState.queues.get(conversationId) ?? []
      // Only act when items were added (enqueue), not removed (dismiss)
      if (curr.length <= prev.length) return

      const prevIds = new Set(prev.map((i) => i.id))
      const newItems = curr.filter((i) => !prevIds.has(i.id))
      for (const item of newItems) {
        api.injectContext(conversationId, item.payload.text)
        useMessageQueueStore.getState().dismiss(conversationId, item.id)
      }
    })

    return unsub
  }, [status, conversationId, paused])
}
