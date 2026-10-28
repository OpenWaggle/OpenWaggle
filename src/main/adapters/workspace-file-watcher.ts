import type { WorkspaceFilesChangedEvent } from '@shared/types/workspace-files'
import type { WebContents } from 'electron'
import { createLogger } from '../logger'
import { invalidateWorkspaceFileIndex } from './filesystem-workspace-file-service'
import {
  type BackendEvents,
  chokidarBackend,
  GIT_EXCLUDE_PATH,
  ignored,
  nativeBackend,
  relativeTo,
  WATCH_COALESCE_MS,
  type WatchBackend,
  watchExternalGitExclude,
} from './workspace-file-watcher-backends'
import { WorkspaceGitIgnoreFilter } from './workspace-git-ignore-filter'

const WATCH_BATCH_PATH_LIMIT = 1_000
const logger = createLogger('workspace-file-watcher')

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
