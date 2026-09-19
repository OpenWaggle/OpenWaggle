import type { SessionId } from '@shared/types/brand'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'

const logger = createRendererLogger('session-read-receipt-writer')

interface ReceiptWriteQueue {
  tail: Promise<void> | null
  confirmedValue: number | undefined
  latestAttempt: number
}

interface ReceiptStateAccess {
  getValue(id: SessionId): number | undefined
  setValue(id: SessionId, value: number | undefined): void
  isTerminal(id: SessionId): boolean
  noteTerminalReceiptSettled(): void
}

/** Preserve the user's latest intent while serializing durable writes for each Session. */
export function createSessionReadReceiptWriter(access: ReceiptStateAccess) {
  const receiptWrites = new Map<SessionId, ReceiptWriteQueue>()

  return (id: SessionId, lastVisitedAt: number) => {
    const previousValue = access.getValue(id)
    access.setValue(id, lastVisitedAt)
    if (typeof api.updateSessionTreeUiState !== 'function') return

    let queue = receiptWrites.get(id)
    if (!queue) {
      queue = { tail: null, confirmedValue: previousValue, latestAttempt: 0 }
      receiptWrites.set(id, queue)
    }
    const currentQueue = queue
    const attempt = ++currentQueue.latestAttempt
    const write = async () => {
      try {
        await api.updateSessionTreeUiState(id, { lastVisitedAt })
        currentQueue.confirmedValue = lastVisitedAt
      } catch (error) {
        logger.error('Failed to persist Session read receipt', {
          sessionId: String(id),
          error: String(error),
        })
        if (currentQueue.latestAttempt === attempt && access.getValue(id) === lastVisitedAt) {
          access.setValue(id, currentQueue.confirmedValue)
        }
      } finally {
        if (currentQueue.latestAttempt === attempt && access.isTerminal(id)) {
          access.noteTerminalReceiptSettled()
        }
      }
    }
    const pending = currentQueue.tail === null ? write() : currentQueue.tail.then(write)
    currentQueue.tail = pending.finally(() => {
      if (currentQueue.latestAttempt === attempt) receiptWrites.delete(id)
    })
  }
}
