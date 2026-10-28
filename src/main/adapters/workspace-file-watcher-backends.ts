import { type FSWatcher as NativeWatcher, watch as watchNative } from 'node:fs'
import path from 'node:path'
import { createLogger } from '../logger'
import type { WorkspaceGitIgnoreFilter } from './workspace-git-ignore-filter'

/** File watcher backends of the workspace file watcher (D10), and the paths they leave out. */

export const WATCH_COALESCE_MS = 120
const WATCH_POLL_INTERVAL_MS = 50
const logger = createLogger('workspace-file-watcher')

/** How a project root is watched: the events it reports, and how it stops. */
export interface WatchBackend {
  readonly close: () => Promise<void>
  /** Stops reporting runtime errors (the watcher is closing). */
  readonly stopErrors: () => void
}

/** The repository's own `info/exclude`: a source of the ignore list, so its changes are kept. */
export const GIT_EXCLUDE_PATH = '.git/info/exclude'
/** What chokidar must watch of `.git` to see `info/exclude` change, and nothing more. */
const GIT_EXCLUDE_ANCESTORS = new Set(['.git', '.git/info', GIT_EXCLUDE_PATH])

export function ignored(candidatePath: string) {
  const normalized = candidatePath.replaceAll('\\', '/')
  return /(?:^|\/)(?:\.git|node_modules|dist|out|coverage)(?:\/|$)/u.test(normalized)
}

export function relativeTo(projectRoot: string, changedPath: string) {
  const relative = path.relative(projectRoot, changedPath).replaceAll('\\', '/')
  return relative && relative !== '..' && !relative.startsWith('../') ? relative : undefined
}

export interface BackendEvents {
  readonly onChange: (changedPath: string) => void
  readonly onError: (error: unknown) => void
}

/**
 * A native event without a path: libuv reports a ReadDirectoryChangesW buffer overflow on Windows
 * this way, after a burst such as a checkout. Which files changed is unknown (review R5 P3-3).
 */
const NATIVE_EVENT_WITHOUT_PATH =
  'The file watcher lost track of changes (an event without a path, such as a buffer overflow)'

/**
 * macOS and Windows: one recursive watcher (FSEvents, ReadDirectoryChangesW) for the whole tree,
 * with no initial scan and no per-directory state. chokidar kept a watcher and a listing per
 * directory: +703 MB and 10.8 s on a 100k-file repository (D10).
 */
export function nativeBackend(projectRoot: string, events: BackendEvents): Promise<WatchBackend> {
  return new Promise((resolve, reject) => {
    let watcher: NativeWatcher
    try {
      watcher = watchNative(projectRoot, { recursive: true, persistent: false }, (_event, name) => {
        if (typeof name === 'string') events.onChange(path.join(projectRoot, name))
        else events.onError(new Error(NATIVE_EVENT_WITHOUT_PATH))
      })
    } catch (error) {
      reject(error)
      return
    }
    const onError = (error: unknown) => events.onError(error)
    watcher.on('error', onError)
    resolve({
      close: async () => watcher.close(),
      stopErrors: () => {
        watcher.removeListener('error', onError)
      },
    })
  })
}

/** Linux: chokidar, which also skips directories git ignores instead of watching them. */
export async function chokidarBackend(
  projectRoot: string,
  gitIgnore: WorkspaceGitIgnoreFilter | undefined,
  events: BackendEvents,
): Promise<WatchBackend> {
  const { watch } = await import('chokidar')
  const watcher = watch(projectRoot, {
    ignoreInitial: true,
    ignored: (candidate: string) => {
      const relative = relativeTo(projectRoot, candidate)
      if (relative !== undefined && GIT_EXCLUDE_ANCESTORS.has(relative)) return false
      if (ignored(candidate)) return true
      return relative !== undefined && gitIgnore?.isKnownIgnored(relative) === true
    },
    followSymlinks: false,
    awaitWriteFinish: {
      stabilityThreshold: WATCH_COALESCE_MS,
      pollInterval: WATCH_POLL_INTERVAL_MS,
    },
  })
  const onChange = (_eventName: string, changedPath: string) => events.onChange(changedPath)
  watcher.on('all', onChange)
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        watcher.removeListener('ready', handleReady)
        watcher.removeListener('error', handleError)
      }
      const handleReady = () => {
        cleanup()
        resolve()
      }
      const handleError = (error: unknown) => {
        cleanup()
        reject(error)
      }
      watcher.once('ready', handleReady)
      watcher.once('error', handleError)
    })
  } catch (error) {
    watcher.removeListener('all', onChange)
    await watcher.close().catch(() => undefined)
    throw error
  }
  const onError = (error: unknown) => events.onError(error)
  watcher.on('error', onError)
  return {
    close: () => watcher.close(),
    stopErrors: () => {
      watcher.removeListener('error', onError)
    },
  }
}

/**
 * A linked worktree's `info/exclude` is in the repository's common git directory, outside the
 * tree the watcher sees, so its folder is watched on its own. Undefined when the tree's own
 * `.git/info/exclude` is the file, or there is none.
 */
export function watchExternalGitExclude(
  projectRoot: string,
  gitIgnore: WorkspaceGitIgnoreFilter | undefined,
  onChange: () => void,
): NativeWatcher | undefined {
  const excludeFile = gitIgnore?.excludeFile
  if (!excludeFile || relativeTo(projectRoot, excludeFile) === GIT_EXCLUDE_PATH) return undefined
  try {
    const watcher = watchNative(
      path.dirname(excludeFile),
      { persistent: false },
      (_event, name) => {
        if (name === null || name === path.basename(excludeFile)) onChange()
      },
    )
    watcher.on('error', (error) =>
      logger.warn('Could not watch the repository info/exclude', {
        projectRoot,
        error: error.message,
      }),
    )
    return watcher
  } catch {
    // No `info` folder yet: git reads none, and a new one is picked up when the watcher restarts.
    return undefined
  }
}
