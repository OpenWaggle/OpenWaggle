import type {
  WorkspaceDocumentChange,
  WorkspaceDocumentEditBatch,
} from '@shared/types/workspace-files'
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDocumentChanges(value: unknown) {
  if (!Array.isArray(value)) return null
  const changes: WorkspaceDocumentChange[] = []
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.rangeOffset !== 'number' ||
      !Number.isInteger(candidate.rangeOffset) ||
      candidate.rangeOffset < 0 ||
      typeof candidate.rangeLength !== 'number' ||
      !Number.isInteger(candidate.rangeLength) ||
      candidate.rangeLength < 0 ||
      typeof candidate.text !== 'string'
    ) {
      return null
    }
    changes.push({
      rangeOffset: candidate.rangeOffset,
      rangeLength: candidate.rangeLength,
      text: candidate.text,
    })
  }
  return changes
}

function parseDocumentBatches(value: unknown) {
  if (!Array.isArray(value)) return null
  const batches: WorkspaceDocumentEditBatch[] = []
  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.version !== 'number') return null
    const changes = parseDocumentChanges(candidate.changes)
    if (!Number.isInteger(candidate.version) || candidate.version < 0 || changes === null) {
      return null
    }
    batches.push({ version: candidate.version, changes })
  }
  return batches
}

export function readDraftJournal(
  storage: Storage,
  projectPath: string,
  path: string,
): PersistedDraftJournal | null {
  try {
    const stored = storage.getItem(draftStorageKey(projectPath, path))
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (
      !isRecord(parsed) ||
      typeof parsed.baselineRevision !== 'string' ||
      typeof parsed.baseVersion !== 'number' ||
      typeof parsed.content !== 'string'
    ) {
      logger.warn('Ignored an invalid workspace draft journal', { projectPath, path })
      return null
    }
    const batches = parseDocumentBatches(parsed.batches)
    if (batches === null) {
      logger.warn('Ignored an invalid workspace draft journal', { projectPath, path })
      return null
    }
    return {
      baselineRevision: parsed.baselineRevision,
      baseVersion: parsed.baseVersion,
      content: parsed.content,
      batches,
      conflicted: parsed.conflicted === true,
    }
  } catch (error) {
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
