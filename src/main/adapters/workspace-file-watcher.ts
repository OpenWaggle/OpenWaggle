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
  if (ignored(relative) || entry.gitIgnore?.isKnownIgnored(relative)) return
  if (entry.changedPaths.size < WATCH_BATCH_PATH_LIMIT) entry.changedPaths.add(relative)
  else entry.overflow = true
  scheduleFlush(projectRoot, entry)
}

function queueOverflow(projectRoot: string, entry: WorkspaceWatcher, error: unknown) {
  logger.warn('Workspace file watcher reported an error', {
    projectRoot,
    error: error instanceof Error ? error.message : String(error),
  })
  entry.overflow = true
  scheduleFlush(projectRoot, entry)
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
      if (ignored(candidate)) return true
      const relative = relativeTo(projectRoot, candidate)
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

async function createWatcher(projectRoot: string, subscribers: Map<number, WebContents>) {
  const gitIgnore = await WorkspaceGitIgnoreFilter.create(projectRoot)
  let entry: WorkspaceWatcher | undefined
  const events: BackendEvents = {
    onChange: (changedPath) => {
      if (entry) queueChange(projectRoot, entry, changedPath)
    },
    onError: (error) => {
      if (entry) queueOverflow(projectRoot, entry, error)
    },
  }
  const backend =
    watchPlatform === 'linux'
      ? await chokidarBackend(projectRoot, gitIgnore, events)
      : await nativeBackend(projectRoot, events)
  entry = {
    backend,
    subscribers,
    changedPaths: new Set(),
    gitIgnore,
    timeout: null,
    overflow: false,
  }
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
