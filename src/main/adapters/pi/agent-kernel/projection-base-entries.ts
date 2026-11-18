import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { PiProjectionBase } from '../../../store/session-details/pi-projection-base'
import { contextOmittedEntryIds } from './context-edit-omissions'
import type { PiEntryNodeIds } from './pi-entry-node-ids'

/**
 * How many of the entries the Session's current projection already holds: the entries before its
 * recorded tail, when they are still the first ones Pi loaded (the file only grew since, which the
 * caller checked against the file's bytes). Zero when the base does not describe these entries.
 */
export function retainedEntryCount(
  entries: readonly SessionEntry[],
  base: PiProjectionBase,
  nodeIds: PiEntryNodeIds,
) {
  const count = base.tail.entryCount
  if (count <= 0 || entries.length < count) return 0
  if (entries[count - 1]?.id !== base.tail.lastEntryId) return 0
  const previousLeaf =
    base.tail.leafNodeId === null ? null : nodeIds.toEntryId(base.tail.leafNodeId)
  if (
    previousLeaf !== null &&
    !entries.slice(0, count).some((entry) => entry.id === previousLeaf)
  ) {
    return 0
  }
  return count
}

/** The entries a context edit dropped when the base was projected, from its leaf. */
export function previouslyOmittedEntryIds(
  entries: readonly SessionEntry[],
  count: number,
  base: PiProjectionBase,
  nodeIds: PiEntryNodeIds,
) {
  const previous = entries.slice(0, count)
  const previousLeaf =
    base.tail.leafNodeId === null ? null : nodeIds.toEntryId(base.tail.leafNodeId)
  return contextOmittedEntryIds(
    previous,
    new Map(previous.map((entry) => [entry.id, entry])),
    previousLeaf,
  )
}
