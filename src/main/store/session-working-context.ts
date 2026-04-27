import { isRecord } from '@shared/utils/validation'

export interface SessionWorkingContextAccessors<TEntry> {
  readonly getId: (entry: TEntry) => string
  readonly getParentId: (entry: TEntry) => string | null
  readonly getKind: (entry: TEntry) => string
  readonly getContentJson: (entry: TEntry) => string
}

function getEntryPath<TEntry>(
  entryById: ReadonlyMap<string, TEntry>,
  activeEntryId: string | null,
  accessors: SessionWorkingContextAccessors<TEntry>,
): readonly TEntry[] {
  if (!activeEntryId) {
    return []
  }

  const path: TEntry[] = []
  let currentId: string | null = activeEntryId

  while (currentId) {
    const entry = entryById.get(currentId)
    if (!entry) {
      break
    }
    path.unshift(entry)
    currentId = accessors.getParentId(entry)
  }

  return path
}

function parseContentJson<TEntry>(
  entry: TEntry,
  accessors: SessionWorkingContextAccessors<TEntry>,
): unknown {
  return JSON.parse(accessors.getContentJson(entry))
}

function getCompactionFirstKeptEntryId<TEntry>(
  entry: TEntry,
  accessors: SessionWorkingContextAccessors<TEntry>,
): string | null {
  if (accessors.getKind(entry) !== 'compaction_summary') {
    return null
  }

  const content = parseContentJson(entry, accessors)
  if (!isRecord(content)) {
    return null
  }

  const firstKeptEntryId = content.firstKeptEntryId
  return typeof firstKeptEntryId === 'string' && firstKeptEntryId.trim().length > 0
    ? firstKeptEntryId
    : null
}

function findLatestCompaction<TEntry>(
  path: readonly TEntry[],
  accessors: SessionWorkingContextAccessors<TEntry>,
): {
  readonly entry: TEntry
  readonly index: number
  readonly firstKeptEntryId: string
} | null {
  let latest: {
    readonly entry: TEntry
    readonly index: number
    readonly firstKeptEntryId: string
  } | null = null

  for (let index = 0; index < path.length; index += 1) {
    const entry = path[index]
    const firstKeptEntryId = entry ? getCompactionFirstKeptEntryId(entry, accessors) : null
    if (entry && firstKeptEntryId) {
      latest = { entry, index, firstKeptEntryId }
    }
  }

  return latest
}

function appendNonCompactionEntries<TEntry>(
  target: TEntry[],
  entries: readonly TEntry[],
  accessors: SessionWorkingContextAccessors<TEntry>,
): void {
  for (const entry of entries) {
    if (accessors.getKind(entry) !== 'compaction_summary') {
      target.push(entry)
    }
  }
}

export function buildPiWorkingContextPath<TEntry>(
  activeEntryId: string | null,
  entries: readonly TEntry[],
  accessors: SessionWorkingContextAccessors<TEntry>,
): readonly TEntry[] {
  if (!activeEntryId) {
    return entries
  }

  const entryById = new Map(entries.map((entry) => [accessors.getId(entry), entry]))
  const path = getEntryPath(entryById, activeEntryId, accessors)
  if (path.length === 0) {
    return entries
  }

  const latestCompaction = findLatestCompaction(path, accessors)
  if (!latestCompaction) {
    return path
  }

  const workingContext: TEntry[] = [latestCompaction.entry]
  const firstKeptIndex = path.findIndex(
    (entry) => accessors.getId(entry) === latestCompaction.firstKeptEntryId,
  )

  if (firstKeptIndex >= 0 && firstKeptIndex < latestCompaction.index) {
    appendNonCompactionEntries(
      workingContext,
      path.slice(firstKeptIndex, latestCompaction.index),
      accessors,
    )
  }

  appendNonCompactionEntries(workingContext, path.slice(latestCompaction.index + 1), accessors)
  return workingContext
}
