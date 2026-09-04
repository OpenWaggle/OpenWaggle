import type { AgentSendPayload, AgentSteerDeliveryResult } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { useState } from 'react'
import { useMessageQueueStore } from '@/features/chat/state'
import { parseCompactCommand, parseSessionCopyCommand } from '@/features/composer/commands'
import { createRendererLogger } from '@/shared/lib/logger'
import { reportQueuedSteerFailure } from '../lib/queue-failure-feedback'
import type {
  OptimisticSteerPreviewController,
  SteerDeliveryState,
} from './useOptimisticSteeredTurn'

const logger = createRendererLogger('chat-panel')

interface SteerWorkflowDeps {
  readonly activeSessionId: SessionId | null
  readonly isCompacting: boolean
  readonly steer: (payload: AgentSendPayload) => Promise<AgentSteerDeliveryResult>
  readonly previewSteeredUserTurn: (
    payload: AgentSendPayload,
    deliveryState: SteerDeliveryState,
  ) => OptimisticSteerPreviewController
  readonly withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>
  readonly showToast: (message: string) => void
}

interface SteerWorkflowReturn {
  readonly isSteering: boolean
  readonly handleSteer: (messageId: string) => Promise<void>
}

export function useSteerWorkflow(deps: SteerWorkflowDeps): SteerWorkflowReturn {
  const [inFlightSteerCount, setInFlightSteerCount] = useState(0)
  const {
    activeSessionId,
    isCompacting,
    steer,
    previewSteeredUserTurn,
    withDeferredSnapshotRefresh,
    showToast,
  } = deps

  async function handleSteer(messageId: string) {
    if (!activeSessionId) return
    const queued = useMessageQueueStore
      .getState()
      .queues.get(activeSessionId)
      ?.find((item) => item.id === messageId)
    if (
      queued &&
      (parseCompactCommand(queued.payload.text) || parseSessionCopyCommand(queued.payload.text))
    ) {
      showToast(
        'This command cannot steer an active turn. Leave it queued to run after the turn finishes.',
      )
      return
    }
    const taken = useMessageQueueStore.getState().take(activeSessionId, messageId)
    if (!taken) return
    const { item } = taken
    const deliveryState = isCompacting ? 'waiting-for-compaction' : 'sending'
    const preview = previewSteeredUserTurn(item.payload, deliveryState)
    setInFlightSteerCount((count) => count + 1)
    try {
      const delivery = await withDeferredSnapshotRefresh(() => steer(item.payload))
      if (delivery.delivery === 'handled') {
        preview.clear()
        return
      }
      preview.setDurableContent(delivery.durableText)
      preview.setDeliveryState('sending')
    } catch (error) {
      preview.clear()
      useMessageQueueStore.getState().restore(activeSessionId, taken)
      reportQueuedSteerFailure({ logger, showToast }, activeSessionId, item.id, error)
    } finally {
      setInFlightSteerCount((count) => Math.max(0, count - 1))
    }
  }

  return { isSteering: inFlightSteerCount > 0, handleSteer }
}
