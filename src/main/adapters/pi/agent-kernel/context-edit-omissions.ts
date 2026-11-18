import type { SessionEntry } from '@earendil-works/pi-coding-agent'

type ContextEditEntry = Extract<SessionEntry, { type: 'context_edit' }>

function activePath(entryById: ReadonlyMap<string, SessionEntry>, leafId: string | null) {
  const path: SessionEntry[] = []
  const visited = new Set<string>()
  let entry = leafId === null ? undefined : entryById.get(leafId)
  while (entry && !visited.has(entry.id)) {
    visited.add(entry.id)
    path.push(entry)
    entry = entry.parentId === null ? undefined : entryById.get(entry.parentId)
  }
  return path
}

/**
 * The entries a context edit drops from the model's context (`context_edit` with no
 * replacement), such as an attempt Pi retried. An edit applies on its own branch, and a later one
 * for the same entry replaces it, so an entry on the active branch follows the latest edit on that
 * branch; an entry off it follows the latest edit in the file.
 */
export function contextOmittedEntryIds(
  entries: readonly SessionEntry[],
  entryById: ReadonlyMap<string, SessionEntry>,
  leafId: string | null,
) {
  const path = activePath(entryById, leafId)
  const onActivePath = new Set(path.map((entry) => entry.id))
  const latestEdit = new Map<string, ContextEditEntry>()
  // Nearest the leaf first: the first edit seen for a target is the latest on the branch.
  for (const entry of path) {
    if (entry.type === 'context_edit' && !latestEdit.has(entry.targetId)) {
      latestEdit.set(entry.targetId, entry)
    }
  }
  for (const entry of entries) {
    if (entry.type === 'context_edit' && !onActivePath.has(entry.targetId)) {
      latestEdit.set(entry.targetId, entry)
    }
  }
  return new Set(
    [...latestEdit].flatMap(([targetId, edit]) => (edit.replacement === null ? [targetId] : [])),
  )
}
