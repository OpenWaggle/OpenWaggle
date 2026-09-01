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
const DELETION_TOMBSTONE_MARKER = '.deleting-'
const activeDeletionTombstones = new Set<string>()

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

async function commitDeletionTombstone(tombstone: string) {
  try {
    await fs.rm(tombstone, { recursive: true, force: true })
  } finally {
    activeDeletionTombstones.delete(tombstone)
  }
}

async function rollbackDeletionTombstone(tombstone: string, directory: string, staged: boolean) {
  if (!staged) return
  await fs.rename(tombstone, directory)
  activeDeletionTombstones.delete(tombstone)
}

export function makeFilesystemInlineVisualizationService(
  userDataPath: string,
  dependencies: { readonly beforeSourceOpen?: () => Promise<void> } = {},
): InlineVisualizationServiceShape {
  return {
    prepareSession: (sessionId) =>
      Effect.tryPromise({
        try: async () => {
          const directory = sessionDirectory(userDataPath, sessionId)
          const visualizationsDirectory = path.dirname(directory)
          await fs.mkdir(visualizationsDirectory, { recursive: true })
          const rootStats = await fs.lstat(visualizationsDirectory)
          if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
            throw new InvalidVisualizationPathError('Invalid visualization storage root')
          }
          await reapDeletionTombstones(visualizationsDirectory)
          await fs.mkdir(directory, { recursive: true })
          const sessionStats = await fs.lstat(directory)
          if (sessionStats.isSymbolicLink() || !sessionStats.isDirectory()) {
            throw new InvalidVisualizationPathError('Invalid visualization session directory')
          }
          return directory
        },
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
          const directory = sessionDirectory(userDataPath, sessionId)
          const tombstone = path.join(
            path.dirname(directory),
            `.${path.basename(directory)}${DELETION_TOMBSTONE_MARKER}${randomUUID()}`,
          )
          let staged = false
          try {
            await fs.rename(directory, tombstone)
            staged = true
            activeDeletionTombstones.add(tombstone)
          } catch (cause) {
            if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause
          }
          return {
            commit: Effect.tryPromise({
              try: () => commitDeletionTombstone(tombstone),
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
            const contents = await sourceHandle.readFile('utf8')
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
