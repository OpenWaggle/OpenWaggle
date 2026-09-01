import type { AgentSendPayload } from '@shared/types/agent'
import type { SessionId } from '@shared/types/brand'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMessageQueueStore } from '@/features/chat/state'
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
  readonly steer: (payload: AgentSendPayload) => Promise<void>
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

interface DeferredSteer {
  readonly sessionId: SessionId
  readonly messageId: string
  readonly payload: AgentSendPayload
  readonly preview: OptimisticSteerPreviewController
}

export function useSteerWorkflow(deps: SteerWorkflowDeps): SteerWorkflowReturn {
  const [isSteering, setIsSteering] = useState(false)
  const deferredSteersRef = useRef<DeferredSteer[]>([])
  const {
    activeSessionId,
    isCompacting,
    steer,
    previewSteeredUserTurn,
    withDeferredSnapshotRefresh,
    showToast,
  } = deps

  const deliverSteer = useCallback(
    async (item: DeferredSteer) => {
      setIsSteering(true)
      item.preview.setDeliveryState('sending')
      try {
        await withDeferredSnapshotRefresh(() => steer(item.payload))
      } catch (error) {
        item.preview.clear()
        useMessageQueueStore.getState().enqueue(item.sessionId, item.payload)
        reportQueuedSteerFailure({ logger, showToast }, item.sessionId, item.messageId, error)
      } finally {
        setIsSteering(false)
      }
    },
    [showToast, steer, withDeferredSnapshotRefresh],
  )

  useEffect(() => {
    if (isCompacting || !activeSessionId) return
    const ready = deferredSteersRef.current.filter((item) => item.sessionId === activeSessionId)
    if (ready.length === 0) return
    deferredSteersRef.current = deferredSteersRef.current.filter(
      (item) => item.sessionId !== activeSessionId,
    )
    void ready.reduce(
      (previous, item) => previous.then(() => deliverSteer(item)),
      Promise.resolve(),
    )
  }, [activeSessionId, deliverSteer, isCompacting])

  async function handleSteer(messageId: string) {
    if (!activeSessionId) return
    const queue = useMessageQueueStore.getState().queues.get(activeSessionId)
    const item = queue?.find((i) => i.id === messageId)
    if (!item) return
    useMessageQueueStore.getState().dismiss(activeSessionId, messageId)
    const deliveryState = isCompacting ? 'waiting-for-compaction' : 'sending'
    const deferredSteer = {
      sessionId: activeSessionId,
      messageId,
      payload: item.payload,
      preview: previewSteeredUserTurn(item.payload, deliveryState),
    } satisfies DeferredSteer
    if (isCompacting) {
      deferredSteersRef.current = [...deferredSteersRef.current, deferredSteer]
      return
    }
    await deliverSteer(deferredSteer)
  }

  return { isSteering, handleSteer }
}
