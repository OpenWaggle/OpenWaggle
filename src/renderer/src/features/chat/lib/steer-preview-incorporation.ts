import type { UIMessage } from '@shared/types/chat-ui'
import type { OptimisticSteerPreview } from '@/features/chat/state'
import { incorporatedContentOf } from './steer-preview-matching'

/**
 * The previews with the Host time Pi incorporated `userRow` at, recorded on the first waiting
 * preview it can be (as `awaitingReceiptMessageIndex` pairs them): the same previews when none.
 * Only a message incorporated after the preview began can be its steer, not one the transcript
 * held then: the Run's own prompt with the same text, replayed by a reconnect, is neither. A row a
 * preview already stands for (seen again when a reconnect re-reads the buffer) is no other
 * preview's, and a preview with a receipt only takes a row past its log boundary with its digest.
 * Pi takes promoted steers in promotion order, so a row goes to no preview promoted before one
 * already recorded at a lower log order.
 */
export function withIncorporatedPreview(
  previews: readonly OptimisticSteerPreview[],
  userRow: UIMessage,
): readonly OptimisticSteerPreview[] {
  if (userRow.createdAt === undefined) return previews
  const taken = previews.some(
    (turn) => turn.incorporatedRowId === userRow.id || turn.durableMessageId === userRow.id,
  )
  if (taken) return previews
  const incorporatedAt = new Date(userRow.createdAt).getTime()
  const createdOrder = userRow.metadata?.sessionNodeCreatedOrder
  const shown = incorporatedContentOf(userRow)
  const index = previews.findIndex(
    (turn, at) =>
      turn.incorporatedAt === undefined &&
      inPromotionOrder(previews, at, createdOrder) &&
      turn.durableMessageId === undefined &&
      createdOrder !== undefined &&
      createdOrder > turn.baselineMaxCreatedOrder &&
      !turn.baselineUserMessageIds.has(userRow.id) &&
      incorporatedAt >= new Date(turn.message.createdAt ?? 0).getTime() &&
      fitsReceipt(turn, userRow) &&
      shown.text === turn.incorporatedContent.text &&
      shown.attachmentCount === turn.incorporatedContent.attachmentCount,
  )
  if (index < 0) return previews
  return previews.map((preview, at) =>
    at === index
      ? {
          ...preview,
          incorporatedAt,
          incorporatedRowId: userRow.id,
          incorporatedOrder: createdOrder,
        }
      : preview,
  )
}

/** Whether a row is past a queued receipt's log boundary with its digest (no receipt: any row). */
function fitsReceipt(turn: OptimisticSteerPreview, userRow: UIMessage) {
  if (!turn.receipt) return true
  const order = userRow.metadata?.sessionNodeCreatedOrder
  const digest = userRow.metadata?.durableTextSha256
  return (
    order !== undefined &&
    order > turn.receipt.minimumCreatedOrder &&
    (digest === undefined || digest === turn.receipt.durableTextSha256)
  )
}

/** Whether a row at `createdOrder` keeps the previews' recorded rows in promotion order. */
function inPromotionOrder(
  previews: readonly OptimisticSteerPreview[],
  at: number,
  createdOrder: number | undefined,
) {
  if (createdOrder === undefined) return false
  return previews.every((turn, index) => {
    const order = turn.incorporatedOrder
    if (order === undefined || index === at) return true
    return index < at ? order < createdOrder : order > createdOrder
  })
}
