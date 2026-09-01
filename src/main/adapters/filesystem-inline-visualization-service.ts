import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SessionId } from '@shared/types/brand'
import type { InlineVisualizationReadResult } from '@shared/types/inline-visualization'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { app } from 'electron'
import {
  InlineVisualizationService,
  type InlineVisualizationServiceShape,
} from '../ports/inline-visualization-service'
import { isPathInsideDirectory } from '../utils/project-path-validation'

const VISUALIZATIONS_DIRECTORY = 'visualizations'
const VISUALIZATION_FILENAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/
const SESSION_DIRECTORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const MAX_VISUALIZATION_SOURCE_BYTES = 5 * 1024 * 1024
const INITIAL_VISUALIZATION_READ_BYTES = 64 * 1024
const READ_BUFFER_GROWTH_FACTOR = 2
const DELETION_TOMBSTONE_MARKER = '.deleting-'
const activeDeletionTombstones = new Set<string>()
const activeDeletionDirectories = new Set<string>()
const sessionDirectoryLocks = new Map<string, Promise<void>>()

class InvalidVisualizationPathError extends Error {}

function sessionDirectory(userDataPath: string, sessionId: SessionId) {
  if (!SESSION_DIRECTORY_PATTERN.test(String(sessionId))) {
    throw new InvalidVisualizationPathError('Invalid visualization session identifier')
  }
  return path.join(userDataPath, VISUALIZATIONS_DIRECTORY, String(sessionId))
}

async function resolveAuthorizedSource(
  sourcePath: string,
  authorizedRoots: readonly string[],
): Promise<{
  readonly realSourcePath: string
  readonly device: number
  readonly inode: number
} | null> {
  if (!path.isAbsolute(sourcePath)) return null
  const normalizedSourcePath = path.normalize(sourcePath)

  const lexicalRoot = authorizedRoots
    .map((root) => path.resolve(root))
    .find((root) => isPathInsideDirectory(root, normalizedSourcePath))
  if (!lexicalRoot) return null

  const rootLstat = await fs.lstat(lexicalRoot)
  if (rootLstat.isSymbolicLink() || !rootLstat.isDirectory()) return null
  const realRoot = await fs.realpath(lexicalRoot)
  const relativeSourcePath = path.relative(lexicalRoot, normalizedSourcePath)
  let currentPath = lexicalRoot
  let sourceLstat = rootLstat
  for (const segment of relativeSourcePath.split(path.sep)) {
    if (!segment) continue
    currentPath = path.join(currentPath, segment)
    sourceLstat = await fs.lstat(currentPath)
    if (sourceLstat.isSymbolicLink()) return null
  }
  if (!sourceLstat.isFile()) return null

  const realSourcePath = await fs.realpath(normalizedSourcePath)
  if (!isPathInsideDirectory(realRoot, realSourcePath)) return null
  return { realSourcePath, device: sourceLstat.dev, inode: sourceLstat.ino }
}

async function reapDeletionTombstones(visualizationsDirectory: string) {
  const entries = await fs.readdir(visualizationsDirectory, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.name.includes(DELETION_TOMBSTONE_MARKER))
      .map((entry) => path.join(visualizationsDirectory, entry.name))
      .filter((tombstone) => !activeDeletionTombstones.has(tombstone))
      .map((tombstone) => fs.rm(tombstone, { recursive: true, force: true })),
  )
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

async function commitDeletionTombstone(tombstone: string, directory: string, staged: boolean) {
  if (!staged) return
  try {
    await fs.rm(tombstone, { recursive: true, force: true })
  } finally {
    activeDeletionTombstones.delete(tombstone)
    activeDeletionDirectories.delete(directory)
  }
}

async function rollbackDeletionTombstone(tombstone: string, directory: string, staged: boolean) {
  if (!staged) return
  await fs.rename(tombstone, directory)
  activeDeletionTombstones.delete(tombstone)
  activeDeletionDirectories.delete(directory)
}

async function readVisualizationSource(sourceHandle: fs.FileHandle, initialSize: number) {
  const maximumReadBytes = MAX_VISUALIZATION_SOURCE_BYTES + 1
  let buffer = Buffer.allocUnsafe(
    Math.min(maximumReadBytes, Math.max(INITIAL_VISUALIZATION_READ_BYTES, initialSize + 1)),
  )
  let totalBytesRead = 0
  while (true) {
    if (totalBytesRead === buffer.length) {
      if (buffer.length === maximumReadBytes) break
      const expanded = Buffer.allocUnsafe(
        Math.min(maximumReadBytes, buffer.length * READ_BUFFER_GROWTH_FACTOR),
      )
      buffer.copy(expanded, 0, 0, totalBytesRead)
      buffer = expanded
    }
    const { bytesRead } = await sourceHandle.read(
      buffer,
      totalBytesRead,
      buffer.length - totalBytesRead,
      totalBytesRead,
    )
    if (bytesRead === 0) break
    totalBytesRead += bytesRead
  }
  if (totalBytesRead > MAX_VISUALIZATION_SOURCE_BYTES) return null
  return buffer.subarray(0, totalBytesRead).toString('utf8')
}

async function prepareVisualizationSession(userDataPath: string, sessionId: SessionId) {
  const directory = sessionDirectory(userDataPath, sessionId)
  return withSessionDirectoryLock(directory, async () => {
    const visualizationsDirectory = path.dirname(directory)
    await fs.mkdir(visualizationsDirectory, { recursive: true })
    const rootStats = await fs.lstat(visualizationsDirectory)
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
      throw new InvalidVisualizationPathError('Invalid visualization storage root')
    }
    await reapDeletionTombstones(visualizationsDirectory)
    if (activeDeletionDirectories.has(directory)) {
      throw new InvalidVisualizationPathError('Visualization session deletion is in progress')
    }
    await fs.mkdir(directory, { recursive: true })
    const sessionStats = await fs.lstat(directory)
    if (sessionStats.isSymbolicLink() || !sessionStats.isDirectory()) {
      throw new InvalidVisualizationPathError('Invalid visualization session directory')
    }
    return directory
  })
}

async function stageVisualizationSessionDeletion(userDataPath: string, sessionId: SessionId) {
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
      activeDeletionTombstones.add(tombstone)
      return { staged: true, tombstone }
    } catch (cause) {
      activeDeletionDirectories.delete(directory)
      if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause
      return { staged: false, tombstone }
    }
  })
  return { ...stagedDeletion, directory }
}

export function makeFilesystemInlineVisualizationService(
  userDataPath: string,
  dependencies: {
    readonly beforeSourceOpen?: () => Promise<void>
    readonly beforeSourceRead?: () => Promise<void>
  } = {},
): InlineVisualizationServiceShape {
  return {
    prepareSession: (sessionId) =>
      Effect.tryPromise({
        try: () => prepareVisualizationSession(userDataPath, sessionId),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    deleteSession: (sessionId) =>
      Effect.tryPromise({
        try: async () => {
          await fs.rm(sessionDirectory(userDataPath, sessionId), { recursive: true, force: true })
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    stageSessionDeletion: (sessionId) =>
      Effect.tryPromise({
        try: async () => {
          const { staged, tombstone, directory } = await stageVisualizationSessionDeletion(
            userDataPath,
            sessionId,
          )
          return {
            commit: Effect.tryPromise({
              try: () => commitDeletionTombstone(tombstone, directory, staged),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            }),
            rollback: Effect.tryPromise({
              try: () => rollbackDeletionTombstone(tombstone, directory, staged),
              catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
            }),
          }
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    readSource: ({ sessionId, sourcePath, workspaceRoots }) =>
      Effect.promise(async (): Promise<InlineVisualizationReadResult> => {
        try {
          const filename = path.basename(sourcePath)
          if (!VISUALIZATION_FILENAME_PATTERN.test(filename)) {
            return { status: 'unavailable', reason: 'invalid-path' }
          }
          const resolved = await resolveAuthorizedSource(sourcePath, [
            sessionDirectory(userDataPath, sessionId),
            ...workspaceRoots,
          ])
          if (!resolved) return { status: 'unavailable', reason: 'invalid-path' }
          await dependencies.beforeSourceOpen?.()
          const sourceHandle = await fs.open(
            resolved.realSourcePath,
            fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
          )
          try {
            const openedStats = await sourceHandle.stat()
            if (
              !openedStats.isFile() ||
              openedStats.dev !== resolved.device ||
              openedStats.ino !== resolved.inode
            ) {
              return { status: 'unavailable', reason: 'invalid-path' }
            }
            if (openedStats.size > MAX_VISUALIZATION_SOURCE_BYTES) {
              return { status: 'unavailable', reason: 'too-large' }
            }
            await dependencies.beforeSourceRead?.()
            const contents = await readVisualizationSource(sourceHandle, openedStats.size)
            if (contents === null) return { status: 'unavailable', reason: 'too-large' }
            return {
              status: 'loaded',
              contents,
              sizeBytes: Buffer.byteLength(contents),
            }
          } finally {
            await sourceHandle.close()
          }
        } catch (cause) {
          if (cause instanceof InvalidVisualizationPathError) {
            return { status: 'unavailable', reason: 'invalid-path' }
          }
          const code = cause instanceof Error && 'code' in cause ? cause.code : undefined
          return {
            status: 'unavailable',
            reason: code === 'ENOENT' ? 'missing' : 'read-failed',
          }
        }
      }),
  }
}

export const FilesystemInlineVisualizationLive = Layer.effect(
  InlineVisualizationService,
  Effect.sync(() =>
    InlineVisualizationService.of(
      makeFilesystemInlineVisualizationService(app.getPath('userData')),
    ),
  ),
)
