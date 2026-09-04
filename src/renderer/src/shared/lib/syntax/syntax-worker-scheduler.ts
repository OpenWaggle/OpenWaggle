import type { SyntaxQueuedRequest } from './syntax-cache'
import type { SyntaxWorkerSlot } from './syntax-worker-slot'

function sourceIsActiveElsewhere(
  slots: readonly SyntaxWorkerSlot[],
  slot: SyntaxWorkerSlot,
  request: SyntaxQueuedRequest,
) {
  return slots.some(
    (candidate) => candidate !== slot && candidate.current?.sourceKey === request.sourceKey,
  )
}

export function shouldCreateSyntaxWorkerSlot(
  slots: readonly SyntaxWorkerSlot[],
  queue: readonly SyntaxQueuedRequest[],
  workerLimit: number,
) {
  if (slots.length >= workerLimit) return false
  const idleCount = slots.filter((slot) => slot.current === null).length
  if (queue.length <= idleCount) return false
  return queue.some((queued) => !slots.some((slot) => slot.current?.sourceKey === queued.sourceKey))
}

export function nextSyntaxQueueIndex(
  slots: readonly SyntaxWorkerSlot[],
  slot: SyntaxWorkerSlot,
  queue: readonly SyntaxQueuedRequest[],
) {
  const preferredIndex = queue.findIndex(
    (queued) =>
      slot.knownSourceKeys.has(queued.sourceKey) && !sourceIsActiveElsewhere(slots, slot, queued),
  )
  if (preferredIndex >= 0) return preferredIndex
  return queue.findIndex((queued) => !sourceIsActiveElsewhere(slots, slot, queued))
}

export function takeSupersededSyntaxViewportRequests(
  queue: SyntaxQueuedRequest[],
  next: SyntaxQueuedRequest,
) {
  if (!next.input.lineRange || !next.input.signal) return []
  const superseded: SyntaxQueuedRequest[] = []
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const queued = queue[index]
    if (
      !queued?.input.lineRange ||
      queued.sourceKey !== next.sourceKey ||
      queued.input.signal !== next.input.signal
    ) {
      continue
    }
    queue.splice(index, 1)
    superseded.push(queued)
  }
  return superseded
}
