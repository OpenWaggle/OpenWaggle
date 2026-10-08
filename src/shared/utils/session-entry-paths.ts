import { parseJsonUnknown } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'

/*
 * Two paths through a Session's Pi entries (ADR 0048).
 *
 * The transcript path is what the user reads: the active branch from its root, in Pi log order,
 * with every compaction and branch summary where Pi appended it. Compaction never hides earlier
 * messages from the user.
 *
 * The model-context path is what Pi builds the model's context from after its latest compaction:
 * that compaction first, then the entries it kept, then everything appended after it. The model
 * never reads it from OpenWaggle: Pi builds the context itself from its Session file
 * (`buildSessionContext`), and it alone resolves a Native checkpoint the next model cannot replay.
 * This mirror exists so a reader of the projection can tell which entries Pi keeps in context; it
 * must never decide what the transcript shows.
 */

export interface SessionEntryPathAccessors<TEntry> {
  readonly getId: (entry: TEntry) => string
  readonly getParentId: (entry: TEntry) => string | null
}

export interface SessionModelContextAccessors<TEntry> extends SessionEntryPathAccessors<TEntry> {
  readonly getKind: (entry: TEntry) => string
  readonly getContentJson: (entry: TEntry) => string
}

const COMPACTION_KIND = 'compaction_summary'

/** The entries from the root to `activeEntryId`, oldest first, or null when it is not known. */
function getEntryPath<TEntry>(
  activeEntryId: string | null,
  entries: readonly TEntry[],
  accessors: SessionEntryPathAccessors<TEntry>,
): TEntry[] | null {
  if (!activeEntryId) return null
  const entryById = new Map(entries.map((entry) => [accessors.getId(entry), entry]))
  const path: TEntry[] = []
  const visited = new Set<string>()
  let currentId: string | null = activeEntryId

  while (currentId && !visited.has(currentId)) {
    const entry = entryById.get(currentId)
    if (!entry) break
    visited.add(currentId)
    path.push(entry)
    currentId = accessors.getParentId(entry)
  }

  return path.length > 0 ? path.reverse() : null
}

/**
 * The entries the transcript shows for the branch ending at `activeEntryId`: its whole path in Pi
 * log order, every compaction marker and branch summary in place. Without a known active entry it
 * is every entry, as Pi falls back to the newest one.
 */
export function buildPiTranscriptPath<TEntry>(
  activeEntryId: string | null,
  entries: readonly TEntry[],
  accessors: SessionEntryPathAccessors<TEntry>,
): readonly TEntry[] {
  return getEntryPath(activeEntryId, entries, accessors) ?? entries
}

function compactionFirstKeptEntryId<TEntry>(
  entry: TEntry,
  accessors: SessionModelContextAccessors<TEntry>,
) {
  if (accessors.getKind(entry) !== COMPACTION_KIND) return null
  const content = parseJsonUnknown(accessors.getContentJson(entry))
  if (!isRecord(content)) return null
  const firstKeptEntryId = content.firstKeptEntryId
  return typeof firstKeptEntryId === 'string' && firstKeptEntryId.trim().length > 0
    ? firstKeptEntryId
    : null
}

function findLatestCompaction<TEntry>(
  path: readonly TEntry[],
  accessors: SessionModelContextAccessors<TEntry>,
) {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const entry = path[index]
    const firstKeptEntryId = entry ? compactionFirstKeptEntryId(entry, accessors) : null
    if (entry && firstKeptEntryId) return { entry, index, firstKeptEntryId }
  }
  return null
}

function withoutCompactions<TEntry>(
  entries: readonly TEntry[],
  accessors: SessionModelContextAccessors<TEntry>,
) {
  return entries.filter((entry) => accessors.getKind(entry) !== COMPACTION_KIND)
}

/**
 * The entries Pi builds the model's context from for the branch ending at `activeEntryId`, in Pi's
 * order: the latest compaction, the entries it kept, then the entries after it. An earlier
 * compaction inside the kept range adds nothing to the context, so it is left out. A checkpoint
 * that keeps no entry on the path (a Native replacement) is followed only by later entries.
 */
export function buildPiModelContextPath<TEntry>(
  activeEntryId: string | null,
  entries: readonly TEntry[],
  accessors: SessionModelContextAccessors<TEntry>,
): readonly TEntry[] {
  const path = getEntryPath(activeEntryId, entries, accessors)
  if (!path) return entries
  const latest = findLatestCompaction(path, accessors)
  if (!latest) return path

  const firstKeptIndex = path.findIndex(
    (entry) => accessors.getId(entry) === latest.firstKeptEntryId,
  )
  const kept =
    firstKeptIndex >= 0 && firstKeptIndex < latest.index
      ? withoutCompactions(path.slice(firstKeptIndex, latest.index), accessors)
      : []
  return [latest.entry, ...kept, ...path.slice(latest.index + 1)]
}
