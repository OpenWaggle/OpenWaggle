import { randomUUID } from 'node:crypto'
import { open, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isRecord } from '@shared/utils/validation'
import { logger } from './constants'

/**
 * Pi entry fields that name another entry of the same session file. `parentId` links the tree;
 * the rest are Pi's cross-entry references (compaction, branch summary, label, context edit).
 */
const ENTRY_REFERENCE_FIELDS = ['parentId', 'firstKeptEntryId', 'fromId', 'targetId'] as const

/**
 * Pi records a compaction reconstruction as a custom entry whose data names entries of the file.
 * Pi only compares these ids to avoid recording the same reconstruction twice.
 */
const RECONSTRUCTION_CUSTOM_TYPE = 'pi.compaction_reconstruction'
const RECONSTRUCTION_REFERENCE_FIELDS = [
  'sourceCompactionId',
  'firstKeptEntryId',
  'droppedThroughEntryId',
] as const

/**
 * A full UUID rather than Pi's eight-character id. The new ids join a node key shared by every
 * Session, and a fork mints them all at once: eight hex characters collide with an existing node
 * too often at that scale, and a full UUID can never equal an id Pi generates later.
 */
function nextEntryId(taken: ReadonlySet<string>) {
  while (true) {
    const id = randomUUID()
    if (!taken.has(id)) return id
  }
}

function isSessionEntry(line: unknown): line is { readonly id: string; readonly type: string } {
  return isRecord(line) && line.type !== 'session' && typeof line.id === 'string'
}

/**
 * Gives the selected entries of a Pi session new ids, keeping the tree and every cross-entry
 * reference intact. Entries that are not selected keep their ids.
 */
export function rekeySessionLines(
  lines: readonly unknown[],
  shouldRekey: (entryId: string) => boolean,
): {
  readonly lines: readonly unknown[]
  /** The previous id of each entry that was given a new id, keyed by the new id. */
  readonly sourceIdById: ReadonlyMap<string, string>
} {
  const taken = new Set<string>()
  for (const line of lines) {
    if (isSessionEntry(line)) taken.add(line.id)
  }
  const idMap = new Map<string, string>()
  for (const line of lines) {
    if (!isSessionEntry(line) || !shouldRekey(line.id)) continue
    const id = nextEntryId(taken)
    taken.add(id)
    idMap.set(line.id, id)
  }

  const rekeyed = lines.map((line) => {
    if (!isSessionEntry(line)) return line
    const next = remapReferences({ ...line, id: idMap.get(line.id) ?? line.id }, idMap, [
      ...ENTRY_REFERENCE_FIELDS,
    ])
    if (next.customType === RECONSTRUCTION_CUSTOM_TYPE && isRecord(next.data)) {
      next.data = remapReferences({ ...next.data }, idMap, [...RECONSTRUCTION_REFERENCE_FIELDS])
    }
    return next
  })
  const sourceIdById = new Map([...idMap].map(([sourceId, id]) => [id, sourceId] as const))
  return { lines: rekeyed, sourceIdById }
}

/**
 * Gives every entry of a freshly forked Pi session a new id, keeping the tree and every
 * cross-entry reference intact.
 *
 * Pi forks by copying the source path into a new session file with the source entry ids. Pi only
 * needs ids to be unique within one file, but OpenWaggle projects every session into one SQLite
 * node table keyed by id, so a copy that keeps the source ids collides with the source session's
 * own nodes and the fork cannot be saved. Re-keying the new file before it is projected keeps the
 * forked session a normal Pi session with ids of its own.
 */
export function rekeyForkedSessionLines(lines: readonly unknown[]) {
  return rekeySessionLines(lines, () => true)
}

function remapReferences(
  record: Record<string, unknown>,
  idMap: ReadonlyMap<string, string>,
  fields: readonly string[],
) {
  for (const field of fields) {
    const reference = record[field]
    if (typeof reference === 'string') record[field] = idMap.get(reference) ?? reference
  }
  return record
}

/**
 * Makes a rename durable where the filesystem allows it. Windows cannot open a directory for
 * fsync, and network and FUSE mounts may refuse it; the rename has already replaced the file
 * then, so a refusal is logged rather than reported as a failed write.
 */
async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return
  try {
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    logger.warn('Could not sync the Pi session directory after replacing a file', {
      directory,
      code: isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown',
    })
  }
}

/**
 * Replaces a Pi session file with the given lines atomically and durably: the new content is
 * synced before it replaces the file, and the directory after, so a crash leaves either the old
 * file or the new one, never a truncated one.
 *
 * With `unchangedSince`, the file is replaced only if its size and modification time still match,
 * so an append that raced the rewrite is not lost; the result says whether it was replaced.
 */
export async function writeSessionLinesAtomically(
  sessionFile: string,
  lines: readonly unknown[],
  options: { readonly unchangedSince?: { readonly size: number; readonly mtimeMs: number } } = {},
) {
  const temporaryFile = `${sessionFile}.${randomUUID()}.rekey`
  try {
    const handle = await open(temporaryFile, 'w')
    try {
      await handle.writeFile(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (options.unchangedSince) {
      const current = await stat(sessionFile)
      if (
        current.size !== options.unchangedSince.size ||
        current.mtimeMs !== options.unchangedSince.mtimeMs
      ) {
        await rm(temporaryFile, { force: true })
        return false
      }
    }
    await rename(temporaryFile, sessionFile)
    await syncDirectory(dirname(sessionFile))
    return true
  } catch (error) {
    await rm(temporaryFile, { force: true })
    throw error
  }
}

/**
 * Writes a forked Pi session with fresh entry ids; see {@link rekeyForkedSessionLines}.
 *
 * The lines come from the fork's in-memory session, not from its file: Pi writes a fork file only
 * once the copied path holds an assistant message, so a fork of a Session's first message has no
 * file yet. The file is created or replaced atomically.
 */
export async function writeRekeyedForkedSession(sessionFile: string, lines: readonly unknown[]) {
  const rekeyed = rekeyForkedSessionLines(lines)
  await writeSessionLinesAtomically(sessionFile, rekeyed.lines)
  return rekeyed.sourceIdById
}
