import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import type { SyntaxQueuedRequest } from './syntax-cache'

export interface SyntaxWorkerSlot {
  worker: Worker
  current: SyntaxQueuedRequest | null
  currentSourceSent: boolean
  readonly knownSourceKeys: Set<string>
  timeout: number | null
}

export function clearSyntaxWorkerSlotTimer(slot: SyntaxWorkerSlot) {
  if (slot.timeout !== null) window.clearTimeout(slot.timeout)
  slot.timeout = null
}

export function retireSyntaxWorkerSlot(slots: SyntaxWorkerSlot[], slot: SyntaxWorkerSlot) {
  const current = slot.current
  clearSyntaxWorkerSlotTimer(slot)
  slot.worker.terminate()
  const slotIndex = slots.indexOf(slot)
  if (slotIndex >= 0) slots.splice(slotIndex, 1)
  slot.current = null
  return current
}

export function rememberSyntaxWorkerSource(slot: SyntaxWorkerSlot, sourceKey: string) {
  slot.knownSourceKeys.delete(sourceKey)
  slot.knownSourceKeys.add(sourceKey)
  while (
    slot.knownSourceKeys.size > WORKSPACE_EDITOR_PERFORMANCE.SYNTAX_WORKER_TOKEN_CACHE_MAX_ENTRIES
  ) {
    const oldest = slot.knownSourceKeys.values().next()
    if (oldest.done) break
    slot.knownSourceKeys.delete(oldest.value)
  }
}
