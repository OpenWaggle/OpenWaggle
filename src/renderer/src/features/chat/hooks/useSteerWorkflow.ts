import { matchBy } from '@diegogbrisa/ts-match'
import type { SessionId } from '@shared/types/brand'
import type { SessionControlSteeringReceipt } from '@shared/types/session-control'
import { selectPendingSteerFollowUps, useOptimisticSteerStore } from '@/features/chat/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { reportQueuedSteerFailure } from '../lib/queue-failure-feedback'
import type { AgentChatReturn } from './useAgentChat.types'
import type { OptimisticSteerPreviewController } from './useOptimisticSteeredTurn'
import type { SessionFollowUpQueueItem } from './useSessionFollowUpQueue'

const logger = createRendererLogger('chat-panel')

interface SteerWorkflowDeps {
  readonly activeSessionId: SessionId | null
  readonly followUps: readonly SessionFollowUpQueueItem[]
  readonly isCompacting: boolean
  readonly previewSteeredUserTurn: AgentChatReturn['previewSteeredUserTurn']
  readonly promoteFollowUp: (followUpId: string) => Promise<SessionControlSteeringReceipt>
  readonly withDeferredSnapshotRefresh: <T>(operation: () => Promise<T>) => Promise<T>
  readonly showToast: (message: string) => void
}

interface SteerWorkflowReturn {
  readonly isSteering: boolean
  readonly handleSteer: (messageId: string) => Promise<void>
}

export function useSteerWorkflow(deps: SteerWorkflowDeps): SteerWorkflowReturn {
  const { activeSessionId, promoteFollowUp, withDeferredSnapshotRefresh, showToast } = deps
  const pendingPromotions = useOptimisticSteerStore(selectPendingSteerFollowUps(activeSessionId))

  async function handleSteer(messageId: string) {
    if (!activeSessionId) return
    const item = deps.followUps.find((candidate) => candidate.id === messageId)
    if (!item || !useOptimisticSteerStore.getState().beginPromotion(activeSessionId, messageId))
      return
    let preview: OptimisticSteerPreviewController | undefined
    try {
      // This is display-only: the Host still resolves the original immutable attachments and
      // intent by Follow-up ID. Never reconstruct a delivery payload from the queue preview.
      const attachmentSummary =
        item.attachmentCount > 0 ? `[${item.attachmentCount} attachments]` : ''
      preview = deps.previewSteeredUserTurn(
        {
          text: [item.text, attachmentSummary].filter(Boolean).join('\n\n'),
          thinkingLevel: item.thinkingLevel ?? 'off',
          attachments: [],
        },
        deps.isCompacting ? 'waiting-for-compaction' : 'sending',
      )
      preview.setReceipt(null)
      const receipt = await withDeferredSnapshotRefresh(() => promoteFollowUp(messageId))
      const acceptedPreview = preview
      matchBy(receipt, 'delivery')
        .with('handled', () => acceptedPreview.clear())
        .with('queued', (queued) => {
          acceptedPreview.setReceipt(queued)
          acceptedPreview.setDeliveryState('sending')
        })
        .with('unavailable', () => acceptedPreview.setDeliveryState('sending'))
        .exhaustive()
    } catch (error) {
      preview?.clear()
      reportQueuedSteerFailure({ logger, showToast }, activeSessionId, messageId, error)
    } finally {
      // The Host has removed an accepted Follow-up, or retained a refused one. A queued receipt
      // keeps its preview until the actual user node arrives, which can follow a long tool call.
      useOptimisticSteerStore.getState().finishPromotion(activeSessionId, messageId)
    }
  }

  return { isSteering: pendingPromotions.length > 0, handleSteer }
}
