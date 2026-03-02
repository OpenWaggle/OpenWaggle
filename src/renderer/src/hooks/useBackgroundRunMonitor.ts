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
 * Also refreshes the conversation list when background runs complete so
 * sidebar timestamps and titles stay current.
 */
export function useBackgroundRunMonitor(): void {
  const addActiveRun = useBackgroundRunStore((s) => s.addActiveRun)
  const removeActiveRun = useBackgroundRunStore((s) => s.removeActiveRun)
  const initialize = useBackgroundRunStore((s) => s.initialize)
  const loadConversations = useChatStore((s) => s.loadConversations)

  useEffect(() => {
    void initialize()
  }, [initialize])

  // Track stream lifecycle globally
  useEffect(() => {
    const unsubChunk = api.onStreamChunk((payload) => {
      if (payload.chunk.type === 'RUN_STARTED') {
        addActiveRun(payload.conversationId)
      } else if (isTerminalChunk(payload.chunk)) {
        removeActiveRun(payload.conversationId)
      }
    })

    const unsubCompleted = api.onRunCompleted((payload) => {
      removeActiveRun(payload.conversationId)
      // Refresh conversation list so sidebar titles/timestamps update
      void loadConversations()
    })

    return () => {
      unsubChunk()
      unsubCompleted()
    }
  }, [addActiveRun, removeActiveRun, loadConversations])
}
