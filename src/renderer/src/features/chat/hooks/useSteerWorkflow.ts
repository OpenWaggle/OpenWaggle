import type { SessionId } from '@shared/types/brand'
import { useState } from 'react'
import { createRendererLogger } from '@/shared/lib/logger'
import { reportQueuedSteerFailure } from '../lib/queue-failure-feedback'

const logger = createRendererLogger('chat-panel')

interface SteerWorkflowDeps {
  readonly activeSessionId: SessionId | null
  readonly promoteFollowUp: (followUpId: string) => Promise<void>
  readonly withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>
  readonly showToast: (message: string) => void
}

interface SteerWorkflowReturn {
  readonly isSteering: boolean
  readonly handleSteer: (messageId: string) => Promise<void>
}

export function useSteerWorkflow(deps: SteerWorkflowDeps): SteerWorkflowReturn {
  const [isSteering, setIsSteering] = useState(false)
  const { activeSessionId, promoteFollowUp, withDeferredSnapshotRefresh, showToast } = deps

  async function handleSteer(messageId: string) {
    if (!activeSessionId) return
    setIsSteering(true)
    try {
      await withDeferredSnapshotRefresh(() => promoteFollowUp(messageId))
    } catch (error) {
      reportQueuedSteerFailure({ logger, showToast }, activeSessionId, messageId, error)
    } finally {
      setIsSteering(false)
    }
  }

  return { isSteering, handleSteer }
}
