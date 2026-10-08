import { act } from '@testing-library/react'
import type { AgentChatReturn } from '../useAgentChat.types'
import type { OptimisticSteerPreviewController } from '../useOptimisticSteeredTurn'
import type { HostModel } from './transcript-order.host-model'
import { entryKey, textDigest } from './transcript-order.persisted'

/**
 * Queued Follow-ups the user promotes to steers: the preview shows at once, as `useSteerWorkflow`
 * shows it, and the Host answers the promotion with its receipt once Pi delivered the steer.
 */
export function createPromotions(host: HostModel) {
  /**
   * Each promotion, with the count of user messages of its text the log holds once Pi took it in:
   * Pi takes promoted steers in promotion order, so several may wait with the same text.
   */
  const previews: Array<{
    readonly text: string
    readonly controller: OptimisticSteerPreviewController
    readonly needed: number
  }> = []
  const isIncorporated = (promotion: (typeof previews)[number]) =>
    host.userOrders(promotion.text).length >= promotion.needed
  const deferred: Array<(typeof previews)[number]> = []
  // In a stall: the promotions the renderer still waits on, whatever Pi took meanwhile.
  let stalledPending: Set<(typeof previews)[number]> | null = null
  const forget = (promotions: ReadonlyArray<(typeof previews)[number]>) => {
    const forgotten = new Set(promotions)
    const kept = previews.filter((item) => !forgotten.has(item) || isIncorporated(item))
    previews.splice(0, previews.length, ...kept)
  }
  return {
    /** Promoted steers Pi has not incorporated yet: a prompt with the same text is not one. */
    pendingKeys: () =>
      previews
        .filter((promotion) => stalledPending?.has(promotion) ?? !isIncorporated(promotion))
        .map(({ text }) => entryKey({ role: 'user', text })),
    /** The stream stalls (`true`) or resumes: what Pi takes in a stall the renderer learns later. */
    stalled(stalled: boolean) {
      stalledPending = stalled ? new Set(previews.filter((item) => !isIncorporated(item))) : null
    },
    promote(chat: AgentChatReturn, text: string) {
      act(() => {
        const content = { text, attachmentCount: 0 }
        const controller = chat.previewSteeredUserTurn(
          { text, attachments: [] },
          'sending',
          content,
        )
        controller.setReceipt(null)
        // One back in the Host's queue (its Run ended in a stall) waits for Pi no longer.
        const waiting = previews.filter(
          (promotion) =>
            promotion.text === text && !isIncorporated(promotion) && !deferred.includes(promotion),
        ).length
        const promotion = { text, controller, needed: host.userOrders(text).length + waiting + 1 }
        previews.push(promotion)
        stalledPending?.add(promotion)
        host.rendererActedAt(Date.now())
      })
    },
    /**
     * A Run ended without incorporating them: they return to the queue. In a stall the renderer
     * learns of it only at the resync (`forgetDeferred`).
     */
    forgetUndelivered(stalled = false) {
      const undelivered = previews.filter((promotion) => !isIncorporated(promotion))
      if (stalled) deferred.push(...undelivered)
      else forget(undelivered)
    },
    forgetDeferred: () => forget(deferred.splice(0)),
    /** The Host answers the earliest promotion of `text` with its receipt. */
    answer(text: string) {
      const index = previews.findIndex((promotion) => promotion.text === text)
      const promotion = previews[index]
      if (!promotion) throw new Error(`No promotion of ${text}`)
      const order = host.userOrders(text)[promotion.needed - 1] ?? host.nextOrder()
      act(() => {
        promotion.controller.setReceipt({
          delivery: 'queued',
          durableTextSha256: textDigest(text),
          minimumCreatedOrder: order - 1,
        })
        promotion.controller.setDeliveryState('sending')
      })
      previews.splice(index, 1)
    },
  }
}
