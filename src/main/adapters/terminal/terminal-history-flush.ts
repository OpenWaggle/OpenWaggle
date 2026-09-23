import type { TerminalKey } from '@shared/types/terminal'

export interface PendingHistoryBatch {
  parts: string[]
  bytes: number
  lines: number
  endOffset: number | null
}

export async function persistHistoryBatches(
  batches: readonly (readonly [TerminalKey, PendingHistoryBatch])[],
  retry: [TerminalKey, PendingHistoryBatch][],
  failures: Map<TerminalKey, unknown>,
  append: (key: TerminalKey, batch: PendingHistoryBatch) => Promise<void>,
) {
  const blocked = new Set<TerminalKey>()
  for (const [key, batch] of batches) {
    if (blocked.has(key)) {
      retry.push([key, batch])
      continue
    }
    try {
      await append(key, batch)
      if (batch.endOffset !== null) failures.delete(key)
    } catch (error) {
      failures.set(key, error)
      if (batch.endOffset !== null) retry.push([key, batch])
      blocked.add(key)
    }
  }
}
