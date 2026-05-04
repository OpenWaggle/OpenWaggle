import { matchBy } from '@diegogbrisa/ts-match'
import { useEffect } from 'react'
import { isTerminalTransportEvent } from '@/lib/agent-stream-utils'
import { api } from '@/lib/ipc'
import { useBackgroundRunStore } from '@/stores/background-run-store'
import { useChatStore } from '@/stores/chat-store'

/**
 * Mounted once at the workspace level. Tracks which conversations have
 * active background runs by listening to runtime start/end events
 * and the run-completed event. Does NOT track event content — only presence.
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
    const unsubEvent = api.onAgentEvent((payload) => {
      matchBy(payload.event, 'type')
        .with('agent_start', () => {
          addActiveRun(payload.conversationId)
        })
        .otherwise((event) => {
          if (isTerminalTransportEvent(event)) {
            removeActiveRun(payload.conversationId)
          }
        })
    })

    const unsubCompleted = api.onRunCompleted((payload) => {
      removeActiveRun(payload.conversationId)
      void refreshConversation(payload.conversationId)
    })

    return () => {
      unsubEvent()
      unsubCompleted()
    }
  }, [addActiveRun, refreshConversation, removeActiveRun])
}
