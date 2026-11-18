import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { useEffect } from 'react'
import {
  deliverVisualizationFollowUp,
  registerVisualizationFollowUpDispatcher,
} from '@/features/chat/components/inline-visualization-host'
import type { AgentChatStatus } from './useAgentChat.types'

export function useVisualizationFollowUpDispatcher(input: {
  readonly sessionId: SessionId | null
  readonly status: AgentChatStatus
  readonly send: (payload: AgentSendPayload) => Promise<void>
  readonly enqueue: (payload: AgentSendPayload) => Promise<void>
}) {
  useEffect(() => {
    if (!input.sessionId) return
    const sessionId = input.sessionId
    return registerVisualizationFollowUpDispatcher(sessionId, (payload) =>
      deliverVisualizationFollowUp({
        isIdle: input.status === 'ready' || input.status === 'error',
        payload,
        send: input.send,
        enqueue: input.enqueue,
      }),
    )
  }, [input.enqueue, input.send, input.sessionId, input.status])
}
