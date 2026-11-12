import { decodeUnknownOrThrow, getParseIssuePaths, parseJsonUnknown, Schema } from '@shared/schema'
import type { WorkspaceDocumentEditBatch } from '@shared/types/workspace-files'
import { createRendererLogger } from '@/shared/lib/logger'

const DRAFT_STORAGE_PREFIX = 'openwaggle:document-draft:v1:'
const logger = createRendererLogger('workspace-draft-journal')

function workspaceDraftKey(projectPath: string, path: string) {
  return `${projectPath}\u0000${path}`
}

export function draftStorageKey(projectPath: string, path: string) {
  return `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(workspaceDraftKey(projectPath, path))}`
}

export interface PersistedDraftJournal {
  readonly baselineRevision: string
  readonly baseVersion: number
  readonly content: string
  readonly batches: readonly WorkspaceDocumentEditBatch[]
  readonly conflicted: boolean
}

const nonNegativeInteger = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

const draftJournalSchema = Schema.Struct({
  baselineRevision: Schema.String,
  baseVersion: Schema.Number,
  content: Schema.String,
  batches: Schema.Array(
    Schema.Struct({
      version: nonNegativeInteger,
      changes: Schema.Array(
        Schema.Struct({
          rangeOffset: nonNegativeInteger,
          rangeLength: nonNegativeInteger,
          text: Schema.String,
        }),
      ),
    }),
  ),
  // Anything but `true` reads as not conflicted, as journals written before the flag do.
  conflicted: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

export function readDraftJournal(
  storage: Storage,
  projectPath: string,
  path: string,
): PersistedDraftJournal | null {
  try {
    const stored = storage.getItem(draftStorageKey(projectPath, path))
    if (!stored) return null
    const journal = decodeUnknownOrThrow(draftJournalSchema, parseJsonUnknown(stored))
    return {
      baselineRevision: journal.baselineRevision,
      baseVersion: journal.baseVersion,
      content: journal.content,
      batches: journal.batches,
      conflicted: journal.conflicted === true,
    }
  } catch (error) {
    // Issue paths only: the messages would quote the draft's content.
    const issues = getParseIssuePaths(error)
    if (issues !== null) {
      logger.warn('Ignored an invalid workspace draft journal', { projectPath, path, issues })
      return null
    }
    logger.warn('Could not read a workspace draft journal', {
      projectPath,
      path,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export function removeDraftJournal(storage: Storage, projectPath: string, path: string) {
  storage.removeItem(draftStorageKey(projectPath, path))
}

function draftPathFromStorageKey(storageKey: string, projectPath: string) {
  if (!storageKey.startsWith(DRAFT_STORAGE_PREFIX)) return null
  try {
    const decoded = decodeURIComponent(storageKey.slice(DRAFT_STORAGE_PREFIX.length))
    const prefix = `${projectPath}\u0000`
    return decoded.startsWith(prefix) ? decoded.slice(prefix.length) : null
  } catch {
    return null
  }
}

function affectedPath(candidate: string, path: string) {
  return candidate === path || candidate.startsWith(`${path}/`)
}

export function retargetWorkspaceDraftJournals(
  storage: Storage,
  projectPath: string,
  previousPath: string,
  nextPath: string,
) {
  const moves: {
    readonly sourceKey: string
    readonly targetKey: string
    readonly value: string
  }[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const sourceKey = storage.key(index)
    if (!sourceKey) continue
    const draftPath = draftPathFromStorageKey(sourceKey, projectPath)
    if (!draftPath || !affectedPath(draftPath, previousPath)) continue
    const value = storage.getItem(sourceKey)
    if (value === null) continue
    moves.push({
      sourceKey,
      targetKey: draftStorageKey(projectPath, `${nextPath}${draftPath.slice(previousPath.length)}`),
      value,
    })
  }
  for (const move of moves) {
    storage.setItem(move.targetKey, move.value)
    storage.removeItem(move.sourceKey)
  }
}

export function removeWorkspaceDraftJournals(storage: Storage, projectPath: string, path: string) {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key) continue
    const draftPath = draftPathFromStorageKey(key, projectPath)
    if (draftPath && affectedPath(draftPath, path)) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
}
