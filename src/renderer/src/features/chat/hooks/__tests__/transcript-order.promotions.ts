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
  const previews = new Map<string, OptimisticSteerPreviewController>()
  return {
    /** Promoted steers Pi has not incorporated yet. */
    pendingKeys: () =>
      [...previews.keys()]
        .filter((text) => !host.hasUserMessage(text))
        .map((text) => entryKey({ role: 'user', text })),
    promote(chat: AgentChatReturn, text: string) {
      act(() => {
        const content = { text, attachmentCount: 0 }
        const preview = chat.previewSteeredUserTurn({ text, attachments: [] }, 'sending', content)
        preview.setReceipt(null)
        previews.set(text, preview)
      })
    },
    /** A Run ended without incorporating them: they return to the queue. */
    forgetUndelivered() {
      for (const text of [...previews.keys()]) {
        if (!host.hasUserMessage(text)) previews.delete(text)
      }
    },
    answer(text: string) {
      const preview = previews.get(text)
      if (!preview) throw new Error(`No promotion of ${text}`)
      const order = host.userOrder(text) ?? host.nextOrder()
      act(() => {
        preview.setReceipt({
          delivery: 'queued',
          durableTextSha256: textDigest(text),
          minimumCreatedOrder: order - 1,
        })
        preview.setDeliveryState('sending')
      })
      previews.delete(text)
    },
  }
}
