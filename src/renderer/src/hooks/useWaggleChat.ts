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
  const activeCollaborationId = useWaggleStore((s) => s.activeCollaborationId)

  // Match events against the active collaboration, not just the viewed conversation.
  // This prevents dropping events (including collaboration-complete) when the user
  // switches to a different conversation while waggle is running.
  const targetConversationId = activeCollaborationId ?? conversationId

  useEffect(() => {
    const unsubTurn = api.onWaggleTurnEvent((payload) => {
      if (targetConversationId && payload.conversationId === targetConversationId) {
        handleTurnEvent(payload.event)
      }
    })

    // Track live message -> agent metadata from Waggle stream chunks.
    // When a TEXT_MESSAGE_START arrives, we map the messageId to the agent metadata
    // so ChatPanel can show agent labels during streaming (before persistence).
    const unsubChunk = api.onWaggleStreamChunk((payload) => {
      if (targetConversationId && payload.conversationId === targetConversationId) {
        if (payload.chunk.type === 'TEXT_MESSAGE_START' && payload.chunk.messageId) {
          trackMessageMetadata(payload.chunk.messageId, {
            agentIndex: payload.meta.agentIndex,
            agentLabel: payload.meta.agentLabel,
            agentColor: payload.meta.agentColor,
            agentModel: payload.meta.agentModel,
            turnNumber: payload.meta.turnNumber,
            ...(payload.meta.isSynthesis ? { isSynthesis: true } : {}),
          })
        }
      }
    })

    // Safety net: if the collaboration-complete turn event was missed,
    // onRunCompleted still transitions the store to 'completed'.
    const unsubRunCompleted = api.onRunCompleted((payload) => {
      const state = useWaggleStore.getState()
      if (state.activeCollaborationId === payload.conversationId && state.status === 'running') {
        state.handleTurnEvent({
          type: 'collaboration-complete',
          reason: state.completionReason ?? 'Run completed',
          totalTurns: 0,
        })
      }
    })

    return () => {
      unsubTurn()
      unsubChunk()
      unsubRunCompleted()
    }
  }, [targetConversationId, handleTurnEvent, trackMessageMetadata])
}
