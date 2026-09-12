import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { useEffect } from 'react'
import { type OptimisticSteerPreview, useOptimisticSteerStore } from '@/features/chat/state'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('steer-receipt')
const HEX_BASE = 16
const HEX_BYTE_WIDTH = 2
const digestCache = new WeakMap<UIMessage, { text: string; digest: Promise<string> }>()

function messageDigest(message: UIMessage, text: string) {
  const cached = digestCache.get(message)
  if (cached?.text === text) return cached.digest
  const digest = crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(text))
    .then((buffer) =>
      Array.from(new Uint8Array(buffer), (byte) =>
        byte.toString(HEX_BASE).padStart(HEX_BYTE_WIDTH, '0'),
      ).join(''),
    )
  digestCache.set(message, { text, digest })
  return digest
}

async function receiptMatches(
  messages: readonly UIMessage[],
  previews: readonly OptimisticSteerPreview[],
) {
  const pending = previews.filter((preview) => preview.receipt && !preview.durableMessageId)
  if (pending.length === 0) return previews
  const minimumOrder = Math.min(
    ...pending.map((preview) => preview.receipt?.minimumCreatedOrder ?? Infinity),
  )
  // Visible indexes shrink during compaction, and optimistic IDs change during reconnect.
  // Only the authoritative native log order establishes the receipt's delivery boundary.
  // Cache hashes by immutable message identity. Assistant token
  // streaming must not repeatedly hash a multi-megabyte attachment already in the transcript.
  const candidates = await Promise.all(
    messages.flatMap((message) => {
      const createdOrder = message.metadata?.sessionNodeCreatedOrder
      if (message.role !== 'user' || createdOrder === undefined || createdOrder < minimumOrder)
        return []
      const text = message.parts.find((part) => part.type === 'text')?.content
      return text === undefined
        ? []
        : [
            messageDigest(message, text).then((digest) => ({
              id: message.id,
              createdOrder,
              digest,
            })),
          ]
    }),
  )
  const consumed = new Set(previews.flatMap((preview) => preview.durableMessageCreatedOrder ?? []))
  return previews.map((preview) => {
    if (!preview.receipt || preview.durableMessageId) return preview
    const receipt = preview.receipt
    const match = candidates.find(
      (candidate) =>
        candidate.createdOrder >= receipt.minimumCreatedOrder &&
        !consumed.has(candidate.createdOrder) &&
        candidate.digest === receipt.durableTextSha256,
    )
    if (!match) return preview
    consumed.add(match.createdOrder)
    return {
      ...preview,
      durableMessageId: match.id,
      durableMessageCreatedOrder: match.createdOrder,
    }
  })
}

export function useSteerReceiptReconciliation(
  sessionId: SessionId | null,
  messages: readonly UIMessage[],
  previews: readonly OptimisticSteerPreview[],
) {
  useEffect(() => {
    if (!sessionId || !previews.some((preview) => preview.receipt && !preview.durableMessageId))
      return
    let cancelled = false
    void receiptMatches(messages, previews)
      .then((matched) => {
        if (cancelled || matched.every((preview, index) => preview === previews[index])) return
        useOptimisticSteerStore.getState().reconcile(
          sessionId,
          matched,
          matched.every((preview) => preview.durableMessageId !== undefined),
        )
      })
      .catch((error: unknown) => {
        if (!cancelled)
          logger.error('Could not reconcile the steering delivery receipt', { sessionId, error })
      })
    return () => {
      cancelled = true
    }
  }, [messages, previews, sessionId])
}
