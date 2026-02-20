import type { ConversationId } from '@shared/types/brand'
import type { OrchestrationEventPayload, OrchestrationRunRecord } from '@shared/types/orchestration'
import { useEffect, useState } from 'react'
import { api } from '@/lib/ipc'

interface UseOrchestrationReturn {
  orchestrationRuns: OrchestrationRunRecord[]
  orchestrationEvents: OrchestrationEventPayload[]
  cancelRun: (runId: string) => Promise<void>
}

export function useOrchestration(
  activeConversationId: ConversationId | null,
): UseOrchestrationReturn {
  const [orchestrationRuns, setOrchestrationRuns] = useState<OrchestrationRunRecord[]>([])
  const [orchestrationEvents, setOrchestrationEvents] = useState<OrchestrationEventPayload[]>([])

  useEffect(() => {
    if (!activeConversationId) {
      setOrchestrationRuns([])
      setOrchestrationEvents([])
      return
    }

    void api.listOrchestrationRuns(activeConversationId).then((runs) => setOrchestrationRuns(runs))

    const unsubscribe = api.onOrchestrationEvent((event) => {
      if (event.conversationId !== activeConversationId) return
      setOrchestrationEvents((previous) => [event, ...previous].slice(0, 80))
      void api
        .listOrchestrationRuns(activeConversationId)
        .then((runs) => setOrchestrationRuns(runs))
    })

    return unsubscribe
  }, [activeConversationId])

  function cancelRun(runId: string): Promise<void> {
    return api.cancelOrchestrationRun(runId)
  }

  return { orchestrationRuns, orchestrationEvents, cancelRun }
}
