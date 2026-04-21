import { useEffect } from 'react'
import { api } from '@/lib/ipc'
import { isTerminalChunk } from '@/lib/ipc-connection-adapter'
import { useBackgroundRunStore } from '@/stores/background-run-store'
import { useChatStore } from '@/stores/chat-store'

/**
 * Mounted once at the workspace level. Tracks which conversations have
 * active background runs by listening to stream chunk start/end events
 * and the run-completed event. Does NOT track chunk content — only presence.
 *
 * When a background run completes, updates only the affected conversation's
 * metadata in the sidebar (timestamp) instead of reloading the full list.
 */
export function useBackgroundRunMonitor(): void {
  const addActiveRun = useBackgroundRunStore((s) => s.addActiveRun)
  const removeActiveRun = useBackgroundRunStore((s) => s.removeActiveRun)
  const initialize = useBackgroundRunStore((s) => s.initialize)
  const refreshConversation = useChatStore((s) => s.refreshConversation)

  useEffect(() => {
    void initialize()
  }, [initialize])

  // Track stream lifecycle globally
  useEffect(() => {
    const unsubChunk = api.onStreamChunk((payload) => {
      if (payload.chunk.type === 'RUN_STARTED') {
        addActiveRun(payload.conversationId)
        return
      }
      if (isTerminalChunk(payload.chunk)) {
        removeActiveRun(payload.conversationId)
      }
    })

    const unsubCompleted = api.onRunCompleted((payload) => {
      removeActiveRun(payload.conversationId)
      void refreshConversation(payload.conversationId)
    })

    return () => {
      unsubChunk()
      unsubCompleted()
    }
  }, [addActiveRun, refreshConversation, removeActiveRun])
}
