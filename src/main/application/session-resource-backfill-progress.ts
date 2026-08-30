import type { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import * as Effect from 'effect/Effect'
import type { SessionResourceRepositoryShape } from '../ports/session-resource-repository'
import type { SessionResourceStoreShape } from '../ports/session-resource-store'
import { inspectManagedCopy } from './session-resource-capture-shared'

function generatedImageSlot(occurrenceId: string) {
  if (!occurrenceId.includes(':created:image:')) return null
  const separator = occurrenceId.lastIndexOf(':')
  return separator === -1 ? null : occurrenceId.slice(0, separator + 1)
}

function attachmentOccurrenceIds(resource: SessionResource) {
  return resource.occurrences.flatMap((occurrence) =>
    occurrence.id.includes(':provided:attachment:') ? [occurrence.id] : [],
  )
}

function generatedImageSlots(resource: SessionResource) {
  return resource.occurrences.flatMap((occurrence) => {
    const slot = generatedImageSlot(occurrence.id)
    return slot ? [slot] : []
  })
}

export function loadSessionResourceBackfillProgress(
  resources: readonly SessionResource[],
  repository: SessionResourceRepositoryShape,
  store: SessionResourceStoreShape,
  sessionId: SessionId,
) {
  return Effect.gen(function* () {
    const completedAttachmentOccurrences = new Set<string>()
    const knownAttachmentResources = new Map<string, SessionResource>()
    const completedImageSlots = new Set<string>()
    const knownImageSlots = new Set<string>()

    for (const resource of resources) {
      const attachmentIds = attachmentOccurrenceIds(resource)
      const imageSlots = generatedImageSlots(resource)
      for (const id of attachmentIds) knownAttachmentResources.set(id, resource)
      for (const slot of imageSlots) knownImageSlots.add(slot)
      if (!resource.available || (attachmentIds.length === 0 && imageSlots.length === 0)) continue

      const copy = yield* inspectManagedCopy(repository, store, sessionId, resource.id)
      if (!copy?.readable) continue
      for (const id of attachmentIds) completedAttachmentOccurrences.add(id)
      for (const slot of imageSlots) completedImageSlots.add(slot)
    }

    return {
      completedAttachmentOccurrences,
      knownAttachmentResources,
      completedImageSlots,
      knownImageSlots,
    }
  })
}
