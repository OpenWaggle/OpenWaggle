import type { TerminalKey } from '@shared/types/terminal'

export interface PendingHistoryBatch {
  parts: string[]
  bytes: number
  lines: number
  endOffset: number | null
}

export function discardHistoryFailures(
  matches: (key: TerminalKey) => boolean,
  retry: [TerminalKey, PendingHistoryBatch][],
  failures: Map<TerminalKey, unknown>,
) {
  for (const key of failures.keys()) if (matches(key)) failures.delete(key)
  for (let index = retry.length - 1; index >= 0; index -= 1) {
    const candidate = retry[index]
    if (candidate && matches(candidate[0])) retry.splice(index, 1)
  }
}

export function discardKeyFailure(
  key: TerminalKey,
  retry: [TerminalKey, PendingHistoryBatch][],
  failures: Map<TerminalKey, unknown>,
) {
  discardHistoryFailures((candidate) => candidate === key, retry, failures)
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
      failures.delete(key)
    } catch (error) {
      failures.set(key, error)
      retry.push([key, batch])
      blocked.add(key)
    }
  }
}
