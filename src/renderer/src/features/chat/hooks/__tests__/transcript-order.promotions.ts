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
  return {
    /** Promoted steers Pi has not incorporated yet: a prompt with the same text is not one. */
    pendingKeys: () =>
      previews
        .filter((promotion) => !isIncorporated(promotion))
        .map(({ text }) => entryKey({ role: 'user', text })),
    promote(chat: AgentChatReturn, text: string) {
      act(() => {
        const content = { text, attachmentCount: 0 }
        const controller = chat.previewSteeredUserTurn(
          { text, attachments: [] },
          'sending',
          content,
        )
        controller.setReceipt(null)
        const waiting = previews.filter(
          (promotion) => promotion.text === text && !isIncorporated(promotion),
        ).length
        previews.push({ text, controller, needed: host.userOrders(text).length + waiting + 1 })
        host.rendererActedAt(Date.now())
      })
    },
    /** A Run ended without incorporating them: they return to the queue. */
    forgetUndelivered() {
      const delivered = previews.filter(isIncorporated)
      previews.splice(0, previews.length, ...delivered)
    },
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
