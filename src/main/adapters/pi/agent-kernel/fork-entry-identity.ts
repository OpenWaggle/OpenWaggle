import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { isRecord } from '@shared/utils/validation'

/**
 * Pi entry fields that name another entry of the same session file. `parentId` links the tree;
 * the rest are Pi's cross-entry references (compaction, branch summary, label, context edit).
 */
const ENTRY_REFERENCE_FIELDS = ['parentId', 'firstKeptEntryId', 'fromId', 'targetId'] as const

const PI_ENTRY_ID_LENGTH = 8
const MAX_ID_ATTEMPTS = 100

function nextEntryId(taken: ReadonlySet<string>) {
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt += 1) {
    const id = randomUUID().slice(0, PI_ENTRY_ID_LENGTH)
    if (!taken.has(id)) return id
  }
  return randomUUID()
}

function isSessionEntry(line: unknown): line is { readonly id: string; readonly type: string } {
  return isRecord(line) && line.type !== 'session' && typeof line.id === 'string'
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
export function rekeyForkedSessionLines(lines: readonly unknown[]): readonly unknown[] {
  const taken = new Set<string>()
  for (const line of lines) {
    if (isSessionEntry(line)) taken.add(line.id)
  }
  const idMap = new Map<string, string>()
  for (const line of lines) {
    if (!isSessionEntry(line)) continue
    const id = nextEntryId(taken)
    taken.add(id)
    idMap.set(line.id, id)
  }

  return lines.map((line) => {
    if (!isSessionEntry(line)) return line
    const next: Record<string, unknown> = { ...line, id: idMap.get(line.id) ?? line.id }
    for (const field of ENTRY_REFERENCE_FIELDS) {
      const reference = next[field]
      if (typeof reference === 'string') next[field] = idMap.get(reference) ?? reference
    }
    return next
  })
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
  const temporaryFile = `${sessionFile}.${randomUUID()}.rekey`
  try {
    await writeFile(
      temporaryFile,
      `${rekeyed.map((line) => JSON.stringify(line)).join('\n')}\n`,
      'utf8',
    )
    await rename(temporaryFile, sessionFile)
  } catch (error) {
    await rm(temporaryFile, { force: true })
    throw error
  }
}
