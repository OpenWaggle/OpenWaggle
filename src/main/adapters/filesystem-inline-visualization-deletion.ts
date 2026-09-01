import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SessionId } from '@shared/types/brand'
import { isPathInsideDirectory } from '../utils/project-path-validation'

const VISUALIZATIONS_DIRECTORY = 'visualizations'
const SESSION_DIRECTORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const DELETION_TOMBSTONE_MARKER = '.deleting-'
const activeDeletionDirectories = new Set<string>()
const sessionDirectoryLocks = new Map<string, Promise<void>>()

export class InvalidVisualizationPathError extends Error {}

export function sessionDirectory(userDataPath: string, sessionId: SessionId) {
  if (!SESSION_DIRECTORY_PATTERN.test(String(sessionId))) {
    throw new InvalidVisualizationPathError('Invalid visualization session identifier')
  }
  return path.join(userDataPath, VISUALIZATIONS_DIRECTORY, String(sessionId))
}

async function recoverDeletionTombstone(directory: string) {
  const visualizationsDirectory = path.dirname(directory)
  const tombstonePrefix = `.${path.basename(directory)}${DELETION_TOMBSTONE_MARKER}`
  const entries = await fs.readdir(visualizationsDirectory, { withFileTypes: true })
  const tombstones: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith(tombstonePrefix)) {
      tombstones.push(path.join(visualizationsDirectory, entry.name))
    }
  }
  if (tombstones.length === 0) return
  if (tombstones.length > 1) {
    throw new InvalidVisualizationPathError('Multiple visualization deletion tombstones exist')
  }
  try {
    await fs.lstat(directory)
    throw new InvalidVisualizationPathError(
      'Visualization directory conflicts with a deletion tombstone',
    )
  } catch (cause) {
    if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause
  }
  const tombstone = tombstones[0]
  if (!tombstone) return
  const tombstoneStats = await fs.lstat(tombstone)
  if (tombstoneStats.isSymbolicLink() || !tombstoneStats.isDirectory()) {
    throw new InvalidVisualizationPathError('Invalid visualization deletion tombstone')
  }
  await fs.rename(tombstone, directory)
}

async function withSessionDirectoryLock<T>(directory: string, operation: () => Promise<T>) {
  const previous = sessionDirectoryLocks.get(directory) ?? Promise.resolve()
  const gate = Promise.withResolvers<void>()
  sessionDirectoryLocks.set(directory, gate.promise)
  await previous
  try {
    return await operation()
  } finally {
    gate.resolve()
    if (sessionDirectoryLocks.get(directory) === gate.promise) {
      sessionDirectoryLocks.delete(directory)
    }
  }
}

export async function commitDeletionTombstone(
  tombstone: string,
  directory: string,
  staged: boolean,
) {
  if (!staged) return
  try {
    await fs.rm(tombstone, { recursive: true, force: true })
  } finally {
    activeDeletionDirectories.delete(directory)
  }
}

export async function rollbackDeletionTombstone(
  tombstone: string,
  directory: string,
  staged: boolean,
) {
  if (!staged) return
  await fs.rename(tombstone, directory)
  activeDeletionDirectories.delete(directory)
}

export async function prepareVisualizationSession(userDataPath: string, sessionId: SessionId) {
  const directory = sessionDirectory(userDataPath, sessionId)
  return withSessionDirectoryLock(directory, async () => {
    const visualizationsDirectory = path.dirname(directory)
    await fs.mkdir(visualizationsDirectory, { recursive: true })
    const rootStats = await fs.lstat(visualizationsDirectory)
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new InvalidVisualizationPathError('Invalid visualization storage root')
    }
    if (activeDeletionDirectories.has(directory)) {
      throw new InvalidVisualizationPathError('Visualization session deletion is in progress')
    }
    await recoverDeletionTombstone(directory)
    await fs.mkdir(directory, { recursive: true })
    const sessionStats = await fs.lstat(directory)
    if (sessionStats.isSymbolicLink() || !sessionStats.isDirectory()) {
      throw new InvalidVisualizationPathError('Invalid visualization session directory')
    }
    return directory
  })
}

export async function recoverVisualizationSessionForSource(
  userDataPath: string,
  sessionId: SessionId,
  sourcePath: string,
) {
  const directory = sessionDirectory(userDataPath, sessionId)
  if (!isPathInsideDirectory(directory, path.normalize(sourcePath))) return
  await withSessionDirectoryLock(directory, async () => {
    if (activeDeletionDirectories.has(directory)) {
      throw new InvalidVisualizationPathError('Visualization session deletion is in progress')
    }
    const visualizationsDirectory = path.dirname(directory)
    let rootStats: Awaited<ReturnType<typeof fs.lstat>>
    try {
      rootStats = await fs.lstat(visualizationsDirectory)
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return
      throw cause
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new InvalidVisualizationPathError('Invalid visualization storage root')
    }
    await recoverDeletionTombstone(directory)
  })
}

export async function stageVisualizationSessionDeletion(
  userDataPath: string,
  sessionId: SessionId,
) {
  const directory = sessionDirectory(userDataPath, sessionId)
  const stagedDeletion = await withSessionDirectoryLock(directory, async () => {
    if (activeDeletionDirectories.has(directory)) {
      throw new InvalidVisualizationPathError(
        'Visualization session deletion is already in progress',
      )
    }
    const tombstone = path.join(
      path.dirname(directory),
      `.${path.basename(directory)}${DELETION_TOMBSTONE_MARKER}${randomUUID()}`,
    )
    activeDeletionDirectories.add(directory)
    try {
      await fs.rename(directory, tombstone)
      return { staged: true, tombstone }
    } catch (cause) {
      activeDeletionDirectories.delete(directory)
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause
      return { staged: false, tombstone }
    }
  })
  return { ...stagedDeletion, directory }
}
