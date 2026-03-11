import type { AgentSendPayload } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import { useState } from 'react'
import { createRendererLogger } from '@/lib/logger'
import { useMessageQueueStore } from '@/stores/message-queue-store'
import { reportQueuedSteerFailure } from '../queue-failure-feedback'

const logger = createRendererLogger('chat-panel')

interface SteerWorkflowDeps {
  readonly activeConversationId: ConversationId | null
  readonly steer: () => Promise<void>
  readonly previewSteeredUserTurn: (payload: AgentSendPayload) => () => void
  readonly withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>
  readonly handleSendWithWaggle: (payload: AgentSendPayload) => Promise<void>
  readonly showToast: (message: string) => void
}

interface SteerWorkflowReturn {
  readonly isSteering: boolean
  readonly handleSteer: (messageId: string) => Promise<void>
}

export function useSteerWorkflow(deps: SteerWorkflowDeps): SteerWorkflowReturn {
  const [isSteering, setIsSteering] = useState(false)
  const {
    activeConversationId,
    steer,
    previewSteeredUserTurn,
    withDeferredSnapshotRefresh,
    handleSendWithWaggle,
    showToast,
  } = deps

  async function handleSteer(messageId: string): Promise<void> {
    if (!activeConversationId) return
    const queue = useMessageQueueStore.getState().queues.get(activeConversationId)
    const item = queue?.find((i) => i.id === messageId)
    if (!item) return
    setIsSteering(true)
    useMessageQueueStore.getState().dismiss(activeConversationId, messageId)
    const clearOptimisticSteeredTurn = previewSteeredUserTurn(item.payload)
    try {
      await withDeferredSnapshotRefresh(async () => {
        await steer()
        await handleSendWithWaggle(item.payload)
      })
    } catch (error) {
      clearOptimisticSteeredTurn()
      useMessageQueueStore.getState().enqueue(activeConversationId, item.payload)
      reportQueuedSteerFailure({ logger, showToast }, activeConversationId, messageId, error)
    } finally {
      setIsSteering(false)
    }
  }

  return { isSteering, handleSteer }
}
