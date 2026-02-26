import type { ConversationId } from '@shared/types/brand'
import { useEffect } from 'react'
import { api } from '@/lib/ipc'
import { useWaggleStore } from '@/stores/waggle-store'

/**
 * Subscribe to Waggle IPC events and route them to the collaboration store.
 * Tracks both turn events (status changes) and stream chunks (live message metadata).
 */
export function useWaggleChat(conversationId: ConversationId | null): void {
  const handleTurnEvent = useWaggleStore((s) => s.handleTurnEvent)
  const trackMessageMetadata = useWaggleStore((s) => s.trackMessageMetadata)

  useEffect(() => {
    const unsubTurn = api.onWaggleTurnEvent((payload) => {
      if (conversationId && payload.conversationId === conversationId) {
        handleTurnEvent(payload.event)
      }
    })

    // Track live message -> agent metadata from Waggle stream chunks.
    // When a TEXT_MESSAGE_START arrives, we map the messageId to the agent metadata
    // so ChatPanel can show agent labels during streaming (before persistence).
    const unsubChunk = api.onWaggleStreamChunk((payload) => {
      if (conversationId && payload.conversationId === conversationId) {
        if (payload.chunk.type === 'TEXT_MESSAGE_START' && payload.chunk.messageId) {
          trackMessageMetadata(payload.chunk.messageId, {
            agentIndex: payload.meta.agentIndex,
            agentLabel: payload.meta.agentLabel,
            agentColor: payload.meta.agentColor,
            agentModel: payload.meta.agentModel,
            turnNumber: payload.meta.turnNumber,
          })
        }
      }
    })

    return () => {
      unsubTurn()
      unsubChunk()
    }
  }, [conversationId, handleTurnEvent, trackMessageMetadata])
}
