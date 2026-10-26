import type { HiveSession } from '@/queries/session-hive-contract'

/** Where one Hive member sits: its parent, and the chain of ancestors from the Queen. */
export interface HiveLineageEntry {
  /** 1 for a direct Worker of the Queen; null while an ancestor is not loaded. */
  readonly depth: number | null
  readonly parentId: string | null
  readonly parentTitle: string | null
  /** False until the parent's page arrives (the Queen is always loaded). */
  readonly parentLoaded: boolean
  /** Titles from the Queen down to the parent; `…` stands for ancestors not loaded yet. */
  readonly ancestry: readonly string[]
}

const UNLOADED_ANCESTORS = '…'

/**
 * Every loaded member's parent and ancestry (#377). The tree is keyset-paged by `updated_at`, so
 * a member's parent can be on a later page: such a member keeps its parent's title from its own
 * lineage and is marked `parentLoaded: false`, and its chain starts `Queen › … › parent`.
 */
export function buildHiveLineageIndex(input: {
  readonly root: HiveSession | null
  readonly members: readonly HiveSession[]
}): ReadonlyMap<string, HiveLineageEntry> {
  const rootId = input.root === null ? null : String(input.root.id)
  const rootTitle = input.root?.title ?? ''
  const byId = new Map(input.members.map((member) => [String(member.id), member] as const))
  const index = new Map<string, HiveLineageEntry>()

  const direct: HiveLineageEntry = {
    depth: 1,
    parentId: rootId,
    parentTitle: rootTitle || null,
    parentLoaded: true,
    ancestry: rootTitle ? [rootTitle] : [],
  }

  /** Not loaded yet, or a corrupt cycle: never recurse forever, keep what the row knows. */
  function unloaded(member: HiveSession, parentId: string): HiveLineageEntry {
    const parentTitle = member.lineage?.parentTitle ?? null
    return {
      depth: null,
      parentId,
      parentTitle,
      parentLoaded: false,
      ancestry: [rootTitle, UNLOADED_ANCESTORS, parentTitle ?? UNLOADED_ANCESTORS].filter(
        (title) => title !== '',
      ),
    }
  }

  function computeEntry(member: HiveSession, visiting: Set<string>): HiveLineageEntry {
    const parentId = member.lineage?.parentSessionId ? String(member.lineage.parentSessionId) : null
    if (parentId === null || parentId === rootId) return direct
    const parent = byId.get(parentId)
    if (parent === undefined || visiting.has(parentId)) return unloaded(member, parentId)
    visiting.add(String(member.id))
    const above = entryFor(parent, visiting)
    visiting.delete(String(member.id))
    return {
      depth: above.depth === null ? null : above.depth + 1,
      parentId,
      parentTitle: parent.title,
      parentLoaded: true,
      ancestry: [...above.ancestry, parent.title],
    }
  }

  function entryFor(member: HiveSession, visiting: Set<string>): HiveLineageEntry {
    const id = String(member.id)
    const known = index.get(id)
    if (known) return known
    const entry = computeEntry(member, visiting)
    index.set(id, entry)
    return entry
  }

  for (const member of input.members) entryFor(member, new Set())
  return index
}

/** The ancestry as a tooltip: `Queen › Worker › Worker`. */
export function hiveAncestryLabel(entry: HiveLineageEntry | undefined) {
  return entry === undefined ? '' : entry.ancestry.join(' › ')
}
