import type { SessionResource } from '@shared/types/session-resource'
import type { CaptureAttachmentInput } from './session-resource-capture-attachment'

export interface DeferredAttachmentRepair {
  readonly input: CaptureAttachmentInput
  readonly resource: SessionResource
}

function resumeAfterLastFailedSource(group: readonly DeferredAttachmentRepair[]) {
  const uniqueSources = [
    ...new Map(group.map((repair) => [repair.input.attachment.path, repair])).values(),
  ]
  const resource = uniqueSources[0]?.resource
  if (!resource || resource.available || uniqueSources.length === 1) return uniqueSources
  const cursor = uniqueSources.findIndex(({ input }) => input.attachment.path === resource.locator)
  if (cursor === -1) return uniqueSources
  return [...uniqueSources.slice(cursor + 1), ...uniqueSources.slice(0, cursor + 1)]
}

/** Interleaves resource groups and resumes unavailable shared resources after their last failure. */
export function orderDeferredAttachmentRepairs(deferred: readonly DeferredAttachmentRepair[]) {
  const grouped = new Map<string, DeferredAttachmentRepair[]>()
  for (const repair of deferred) {
    const group = grouped.get(repair.resource.id)
    if (group) group.push(repair)
    else grouped.set(repair.resource.id, [repair])
  }

  const queues = [...grouped.values()].map(resumeAfterLastFailedSource)
  const ordered: DeferredAttachmentRepair[] = []
  let remaining = true
  while (remaining) {
    remaining = false
    for (const queue of queues) {
      const repair = queue.shift()
      if (!repair) continue
      ordered.push(repair)
      remaining = true
    }
  }
  return ordered
}
