import { type FSWatcher as NativeWatcher, watch as watchNative } from 'node:fs'
import path from 'node:path'
import type { WorkspaceFilesChangedEvent } from '@shared/types/workspace-files'
import type { WebContents } from 'electron'
import { createLogger } from '../logger'
import { invalidateWorkspaceFileIndex } from './filesystem-workspace-file-service'
import { WorkspaceGitIgnoreFilter } from './workspace-git-ignore-filter'

const WATCH_COALESCE_MS = 120
const WATCH_BATCH_PATH_LIMIT = 1_000
const WATCH_POLL_INTERVAL_MS = 50
const logger = createLogger('workspace-file-watcher')

/** How a project root is watched: the events it reports, and how it stops. */
interface WatchBackend {
  readonly close: () => Promise<void>
  /** Stops reporting runtime errors (the watcher is closing). */
  readonly stopErrors: () => void
}

interface WorkspaceWatcher {
  readonly backend: WatchBackend
  readonly subscribers: Map<number, WebContents>
  readonly changedPaths: Set<string>
  readonly gitIgnore: WorkspaceGitIgnoreFilter | undefined
  timeout: NodeJS.Timeout | null
  overflow: boolean
}

const watchers = new Map<string, WorkspaceWatcher>()
const pendingWatchers = new Map<string, Promise<WorkspaceWatcher>>()
const subscribersByProject = new Map<string, Map<number, WebContents>>()

let watchPlatform: NodeJS.Platform = process.platform

/** Tests pick the backend: chokidar (`linux`) or one recursive native watcher (others). */
export function setWorkspaceWatcherPlatformForTests(platform: NodeJS.Platform) {
  watchPlatform = platform
}

/** The repository's own `info/exclude`: a source of the ignore list, so its changes are kept. */
const GIT_EXCLUDE_PATH = '.git/info/exclude'
/** What chokidar must watch of `.git` to see `info/exclude` change, and nothing more. */
const GIT_EXCLUDE_ANCESTORS = new Set(['.git', '.git/info', GIT_EXCLUDE_PATH])

function ignored(candidatePath: string) {
  const normalized = candidatePath.replaceAll('\\', '/')
  return /(?:^|\/)(?:\.git|node_modules|dist|out|coverage)(?:\/|$)/u.test(normalized)
}

function relativeTo(projectRoot: string, changedPath: string) {
  const relative = path.relative(projectRoot, changedPath).replaceAll('\\', '/')
  return relative && relative !== '..' && !relative.startsWith('../') ? relative : undefined
}

async function flush(projectRoot: string, entry: WorkspaceWatcher) {
  entry.timeout = null
  const overflow = entry.overflow
  let paths = [...entry.changedPaths]
  entry.changedPaths.clear()
  entry.overflow = false
  if (!overflow && entry.gitIgnore && paths.length > 0) {
    paths = await entry.gitIgnore.keepNotIgnored(paths)
    // Every change was to files git ignores: nothing to tell.
    if (paths.length === 0) return
  }
  const payload: WorkspaceFilesChangedEvent = { workingPath: projectRoot, paths, overflow }
  invalidateWorkspaceFileIndex(projectRoot)
  for (const [id, subscriber] of entry.subscribers) {
    if (subscriber.isDestroyed()) {
      entry.subscribers.delete(id)
    } else {
      subscriber.send('workspace-files:changed', payload)
    }
  }
}

function scheduleFlush(projectRoot: string, entry: WorkspaceWatcher) {
  if (entry.timeout) clearTimeout(entry.timeout)
  entry.timeout = setTimeout(() => void flush(projectRoot, entry), WATCH_COALESCE_MS)
}

function queueChange(projectRoot: string, entry: WorkspaceWatcher, changedPath: string) {
  const relative = relativeTo(projectRoot, changedPath)
  if (relative === undefined) return
  if (
    relative !== GIT_EXCLUDE_PATH &&
    (ignored(relative) || entry.gitIgnore?.isKnownIgnored(relative))
  )
    return
  if (entry.changedPaths.size < WATCH_BATCH_PATH_LIMIT) entry.changedPaths.add(relative)
  else entry.overflow = true
  scheduleFlush(projectRoot, entry)
}

/** Which files changed is unknown: subscribers read the whole listing again. */
function queueRescan(projectRoot: string, entry: WorkspaceWatcher) {
  entry.overflow = true
  scheduleFlush(projectRoot, entry)
}

function queueOverflow(projectRoot: string, entry: WorkspaceWatcher, error: unknown) {
  logger.warn('Workspace file watcher reported an error', {
    projectRoot,
    error: error instanceof Error ? error.message : String(error),
  })
  queueRescan(projectRoot, entry)
}

async function closeWatcher(entry: WorkspaceWatcher) {
  if (entry.timeout) clearTimeout(entry.timeout)
  await entry.backend.close()
  entry.backend.stopErrors()
}

interface BackendEvents {
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
function nativeBackend(projectRoot: string, events: BackendEvents): Promise<WatchBackend> {
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
async function chokidarBackend(
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
function watchExternalGitExclude(
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

async function createWatcher(projectRoot: string, subscribers: Map<number, WebContents>) {
  const gitIgnore = await WorkspaceGitIgnoreFilter.create(projectRoot)
  const pending: { entry?: WorkspaceWatcher } = {}
  const events: BackendEvents = {
    onChange: (changedPath) => {
      if (pending.entry) queueChange(projectRoot, pending.entry, changedPath)
    },
    onError: (error) => {
      if (pending.entry) queueOverflow(projectRoot, pending.entry, error)
    },
  }
  const tree =
    watchPlatform === 'linux'
      ? await chokidarBackend(projectRoot, gitIgnore, events)
      : await nativeBackend(projectRoot, events)
  const exclude = watchExternalGitExclude(projectRoot, gitIgnore, () => {
    const entry = pending.entry
    if (!entry || !gitIgnore) return
    // Which files git ignores changed, not which files exist: the listing is read again.
    void gitIgnore.refresh().then(() => queueRescan(projectRoot, entry))
  })
  const backend: WatchBackend = exclude
    ? {
        close: async () => {
          exclude.close()
          await tree.close()
        },
        stopErrors: tree.stopErrors,
      }
    : tree
  const entry: WorkspaceWatcher = {
    backend,
    subscribers,
    changedPaths: new Set(),
    gitIgnore,
    timeout: null,
    overflow: false,
  }
  pending.entry = entry
  return entry
}

export async function watchWorkspaceFiles(projectRoot: string, subscriber: WebContents) {
  let subscribers = subscribersByProject.get(projectRoot)
  if (!subscribers) {
    subscribers = new Map()
    subscribersByProject.set(projectRoot, subscribers)
  }
  subscribers.set(subscriber.id, subscriber)
  subscriber.once('destroyed', () => {
    void unwatchWorkspaceFiles(projectRoot, subscriber.id)
  })
  if (watchers.has(projectRoot)) return
  let pending = pendingWatchers.get(projectRoot)
  let ownsPending = false
  if (!pending) {
    pending = createWatcher(projectRoot, subscribers)
    pendingWatchers.set(projectRoot, pending)
    ownsPending = true
  }
  let entry: WorkspaceWatcher
  try {
    entry = await pending
  } catch (error) {
    if (ownsPending && subscribersByProject.get(projectRoot) === subscribers) {
      subscribers.clear()
      subscribersByProject.delete(projectRoot)
    }
    throw error
  } finally {
    if (ownsPending && pendingWatchers.get(projectRoot) === pending) {
      pendingWatchers.delete(projectRoot)
    }
  }
  if (!ownsPending || watchers.has(projectRoot)) return
  if (entry.subscribers.size === 0) {
    subscribersByProject.delete(projectRoot)
    await closeWatcher(entry)
    return
  }
  watchers.set(projectRoot, entry)
}

export async function unwatchWorkspaceFiles(projectRoot: string, subscriberId: number) {
  const subscribers = subscribersByProject.get(projectRoot)
  subscribers?.delete(subscriberId)
  const entry = watchers.get(projectRoot)
  if (!entry) {
    if (subscribers?.size === 0 && !pendingWatchers.has(projectRoot)) {
      subscribersByProject.delete(projectRoot)
    }
    return
  }
  if (entry.subscribers.size > 0) return
  watchers.delete(projectRoot)
  subscribersByProject.delete(projectRoot)
  await closeWatcher(entry)
}
