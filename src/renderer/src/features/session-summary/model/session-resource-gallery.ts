import type { SessionResource } from '@shared/types/session-resource'
import { isViewableSessionImage } from './session-resource-viewability'

function activePathOccurrenceTime(
  resource: SessionResource,
  activeMessageIds: ReadonlySet<string>,
) {
  let earliest: number | null = null
  for (const occurrence of resource.occurrences) {
    if (occurrence.nodeId === null || !activeMessageIds.has(occurrence.nodeId)) continue
    earliest = earliest === null ? occurrence.createdAt : Math.min(earliest, occurrence.createdAt)
  }
  return earliest
}

export function orderedSessionImages(
  resources: readonly SessionResource[] | undefined,
  activeMessageIds: ReadonlySet<string>,
) {
  return (resources ?? [])
    .filter(isViewableSessionImage)
    .map((resource) => ({
      resource,
      activeAt: activePathOccurrenceTime(resource, activeMessageIds),
    }))
    .sort((left, right) => {
      const pathOrder = Number(right.activeAt !== null) - Number(left.activeAt !== null)
      if (pathOrder !== 0) return pathOrder
      // Content retries advance updatedAt; immutable capture chronology keeps gallery order stable.
      const timeOrder =
        (left.activeAt ?? left.resource.createdAt) - (right.activeAt ?? right.resource.createdAt)
      return timeOrder !== 0 ? timeOrder : left.resource.id.localeCompare(right.resource.id)
    })
    .map(({ resource }) => resource)
}
