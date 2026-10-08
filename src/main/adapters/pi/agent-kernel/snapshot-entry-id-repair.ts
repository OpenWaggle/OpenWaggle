import { readFile, stat } from 'node:fs/promises'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { isRecord } from '@shared/utils/validation'
import { Effect, Layer } from 'effect'
import type { PersistSessionSnapshotInput } from '../../../ports/session-repository'
import {
  SessionTranscriptRepair,
  SessionTranscriptRepairError,
} from '../../../ports/session-transcript-repair'
import { rekeySessionLines, writeSessionLinesAtomically } from './fork-entry-identity'
import { projectPiSessionSnapshot } from './session-projection'

/** Parses every line, or returns null: a file Pi could only partly read is never rewritten. */
function parseSessionLines(text: string): unknown[] | null {
  const lines: unknown[] = []
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      lines.push(JSON.parse(line))
    } catch {
      return null
    }
  }
  return lines
}

function entryIdsOf(lines: readonly unknown[]) {
  const ids = new Set<string>()
  for (const line of lines) {
    if (isRecord(line) && line.type !== 'session' && typeof line.id === 'string') ids.add(line.id)
  }
  return ids
}

/** Ids, as they were before the rename, of entries whose line the rename changed. */
function changedEntryIds(before: readonly unknown[], after: readonly unknown[]) {
  const changed = new Set<string>()
  before.forEach((line, index) => {
    if (!isRecord(line) || line.type === 'session' || typeof line.id !== 'string') return
    if (JSON.stringify(line) !== JSON.stringify(after[index])) changed.add(line.id)
  })
  return changed
}

/**
 * Gives Pi entries whose ids another Session's projection already holds new ids of their own,
 * in the Pi file and in the snapshot about to be saved.
 *
 * Pi used to mint eight-character entry ids that are only unique within one file, and OpenWaggle
 * keys every Session's nodes by entry id in one table. When a new entry happened to reuse an id
 * another Session holds, every later snapshot of the Session failed, and all of its later turns
 * were missing from the projection, though Pi had written them. OpenWaggle's Pi now mints full
 * UUIDs; this repairs the files written before that, and files Pi wrote elsewhere.
 *
 * Only entries the Session's projection does not hold can collide, because a node id is held by
 * one Session at most, so renaming them changes no saved node of this Session. The file is
 * rewritten atomically and durably, with every reference to a renamed entry. Snapshot nodes of
 * entries the rename changed are projected again from the file; every other node is kept as the
 * caller built it, and nodes that live only in the projection follow a renamed parent.
 *
 * Returns null when the snapshot cannot be repaired this way: no Pi file, a line that does not
 * parse, a conflicting id that is not an entry of the file, a file that kept changing while it was
 * being renamed, or a renamed entry Pi does not load back. Only the last leaves the file renamed,
 * which is harmless: the renamed ids are its own.
 */
export async function repairForeignSnapshotEntryIds(
  input: PersistSessionSnapshotInput,
  foreignNodeIds: ReadonlySet<string>,
): Promise<PersistSessionSnapshotInput | null> {
  const sessionFile = input.piSessionFile
  if (!sessionFile || foreignNodeIds.size === 0) return null
  // An append that lands while the file is rewritten makes the rewrite stand down; try again.
  for (let attempt = 0; attempt < MAX_REWRITE_ATTEMPTS; attempt += 1) {
    const outcome = await renameEntriesOnce(input, sessionFile, foreignNodeIds)
    if (outcome !== 'file-changed') return outcome
  }
  return null
}

const MAX_REWRITE_ATTEMPTS = 3

async function renameEntriesOnce(
  input: PersistSessionSnapshotInput,
  sessionFile: string,
  foreignNodeIds: ReadonlySet<string>,
): Promise<PersistSessionSnapshotInput | null | 'file-changed'> {
  const before = await stat(sessionFile)
  const lines = parseSessionLines(await readFile(sessionFile, 'utf8'))
  if (!lines) return null
  const fileEntryIds = entryIdsOf(lines)
  for (const id of foreignNodeIds) {
    if (!fileEntryIds.has(id)) return null
  }

  const rekeyed = rekeySessionLines(lines, (entryId) => foreignNodeIds.has(entryId))
  const changed = changedEntryIds(lines, rekeyed.lines)
  const newIdByOldId = new Map([...rekeyed.sourceIdById].map(([id, oldId]) => [oldId, id]))
  const written = await writeSessionLinesAtomically(sessionFile, rekeyed.lines, {
    unchangedSince: { size: before.size, mtimeMs: before.mtimeMs },
  })
  if (!written) return 'file-changed'

  const reprojected = projectPiSessionSnapshot({ sessionManager: SessionManager.open(sessionFile) })
  const reprojectedById = new Map(reprojected.nodes.map((node) => [node.id, node]))
  const remap = (id: string) => newIdByOldId.get(id) ?? id
  // An entry Pi skips on load would keep its foreign id in the snapshot; refuse instead.
  const snapshotIds = new Set(input.nodes.map((node) => node.id))
  for (const id of changed) {
    if (snapshotIds.has(id) && !reprojectedById.has(remap(id))) return null
  }
  const nodes = input.nodes.map((node) => {
    const reprojectedNode = changed.has(node.id) ? reprojectedById.get(remap(node.id)) : undefined
    if (reprojectedNode) {
      return {
        ...node,
        id: reprojectedNode.id,
        parentId: reprojectedNode.parentId,
        contentJson: reprojectedNode.contentJson,
      }
    }
    return { ...node, parentId: node.parentId === null ? null : remap(node.parentId) }
  })
  return {
    ...input,
    nodes,
    activeNodeId: input.activeNodeId === null ? null : remap(input.activeNodeId),
  }
}

export const PiSessionTranscriptRepairLive = Layer.succeed(
  SessionTranscriptRepair,
  SessionTranscriptRepair.of({
    renameForeignEntryIds: (input, foreignNodeIds) =>
      Effect.tryPromise({
        try: () => repairForeignSnapshotEntryIds(input, foreignNodeIds),
        catch: (cause) => new SessionTranscriptRepairError({ cause }),
      }),
  }),
)
