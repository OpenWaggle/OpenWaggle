import type { Dirent } from 'node:fs'
import { lstat, opendir } from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { createLogger } from '../logger'
import {
  type WorktreeSpaceMeasurement,
  WorktreeSpaceService,
} from '../ports/worktree-space-service'

const logger = createLogger('worktree-space')

/** A measurement is reused for an hour; the page measures again when it is opened after that. */
export const WORKTREE_SPACE_CACHE_MS = 3_600_000
/** POSIX `st_blocks` counts 512-byte units whatever the file system's block size. */
const STAT_BLOCK_BYTES = 512
/** Parallel `lstat` calls within one walk; walks themselves run one at a time. */
const LSTAT_CONCURRENCY = 32

interface WalkState {
  bytes: number
  readonly device: number
}

function allocatedBytes(stats: { readonly blocks: number; readonly size: number }) {
  // Windows reports no blocks; the size is the best estimate there.
  return Number.isFinite(stats.blocks) && stats.blocks > 0
    ? stats.blocks * STAT_BLOCK_BYTES
    : stats.size
}

async function measureEntry(
  directory: string,
  entry: Dirent,
  state: WalkState,
): Promise<string | null> {
  const entryPath = path.join(directory, entry.name)
  try {
    const stats = await lstat(entryPath)
    // Another file system mounted inside is not freed by removing this folder.
    if (stats.dev !== state.device) return null
    if (stats.isDirectory()) {
      state.bytes += allocatedBytes(stats)
      return entryPath
    }
    // A file hard-linked from elsewhere (a package store) keeps its blocks after removal.
    if (stats.nlink <= 1) state.bytes += allocatedBytes(stats)
  } catch (error) {
    logger.debug('Skipped an entry while measuring a worktree', {
      path: entryPath,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return null
}

async function readEntries(directory: string) {
  const entries: Dirent[] = []
  try {
    for await (const entry of await opendir(directory)) entries.push(entry)
  } catch (error) {
    logger.debug('Skipped a folder while measuring a worktree', {
      path: directory,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return entries
}

/** Reclaimable space of one folder: blocks of everything in it that is not linked from elsewhere. */
export async function measureReclaimableBytes(root: string): Promise<number> {
  const rootStats = await lstat(root)
  if (!rootStats.isDirectory()) return 0
  const state: WalkState = { bytes: allocatedBytes(rootStats), device: rootStats.dev }
  const pending = [root]
  while (pending.length > 0) {
    const directory = pending.pop()
    if (directory === undefined) break
    const entries = await readEntries(directory)
    for (let start = 0; start < entries.length; start += LSTAT_CONCURRENCY) {
      const folders = await Promise.all(
        entries
          .slice(start, start + LSTAT_CONCURRENCY)
          .map((entry) => measureEntry(directory, entry, state)),
      )
      for (const folder of folders) if (folder !== null) pending.push(folder)
    }
  }
  return state.bytes
}

/**
 * The Session Host's measurements, cached for `WORKTREE_SPACE_CACHE_MS`. Walks run one at a time,
 * so opening Settings with many worktrees reads one tree after another rather than all at once.
 */
export function createWorktreeSpaceService(
  options: { readonly now?: () => number; readonly measure?: typeof measureReclaimableBytes } = {},
) {
  const now = options.now ?? Date.now
  const measureFolder = options.measure ?? measureReclaimableBytes
  const cache = new Map<string, WorktreeSpaceMeasurement>()
  const inFlight = new Map<string, Promise<WorktreeSpaceMeasurement>>()
  let queue: Promise<unknown> = Promise.resolve()

  const fresh = (worktreePath: string) => {
    const known = cache.get(worktreePath)
    return known && now() - known.measuredAt < WORKTREE_SPACE_CACHE_MS ? known : null
  }

  const measure = (worktreePath: string) => {
    const known = fresh(worktreePath)
    if (known) return Promise.resolve(known)
    const running = inFlight.get(worktreePath)
    if (running) return running
    const next = queue
      .catch(() => undefined)
      .then(async () => {
        const reclaimableBytes = await measureFolder(worktreePath)
        const measurement = { reclaimableBytes, measuredAt: now() }
        cache.set(worktreePath, measurement)
        return measurement
      })
      .finally(() => inFlight.delete(worktreePath))
    queue = next
    inFlight.set(worktreePath, next)
    return next
  }

  return WorktreeSpaceService.of({
    measure: (worktreePath) =>
      Effect.tryPromise({
        try: () => measure(path.resolve(worktreePath)),
        catch: (cause) => new Error(`Could not measure ${worktreePath}.`, { cause }),
      }),
    cached: (worktreePath) => Effect.sync(() => fresh(path.resolve(worktreePath))),
    forget: (worktreePath) =>
      Effect.sync(() => {
        cache.delete(path.resolve(worktreePath))
      }),
  })
}

export const WorktreeSpaceServiceLive = Layer.sync(WorktreeSpaceService, () =>
  createWorktreeSpaceService(),
)
