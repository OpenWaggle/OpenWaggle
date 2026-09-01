import path from 'node:path'
import type { WorkspaceFilesChangedEvent } from '@shared/types/workspace-files'
import { type FSWatcher, watch } from 'chokidar'
import type { WebContents } from 'electron'
import { createLogger } from '../logger'
import { invalidateWorkspaceFileIndex } from './filesystem-workspace-file-service'

const WATCH_COALESCE_MS = 120
const WATCH_BATCH_PATH_LIMIT = 1_000
const WATCH_POLL_INTERVAL_MS = 50
const logger = createLogger('workspace-file-watcher')

interface WorkspaceWatcher {
  readonly watcher: FSWatcher
  readonly subscribers: Map<number, WebContents>
  readonly changedPaths: Set<string>
  timeout: NodeJS.Timeout | null
  overflow: boolean
  readonly onRuntimeError: (error: unknown) => void
}

const watchers = new Map<string, WorkspaceWatcher>()
const pendingWatchers = new Map<string, Promise<WorkspaceWatcher>>()
const subscribersByProject = new Map<string, Map<number, WebContents>>()

function ignored(candidatePath: string) {
  const normalized = candidatePath.replaceAll('\\', '/')
  return /(?:^|\/)(?:\.git|node_modules|dist|out|coverage)(?:\/|$)/u.test(normalized)
}

function flush(projectRoot: string, entry: WorkspaceWatcher) {
  entry.timeout = null
  const payload: WorkspaceFilesChangedEvent = {
    workingPath: projectRoot,
    paths: [...entry.changedPaths],
    overflow: entry.overflow,
  }
  entry.changedPaths.clear()
  entry.overflow = false
  invalidateWorkspaceFileIndex(projectRoot)
  for (const [id, subscriber] of entry.subscribers) {
    if (subscriber.isDestroyed()) {
      entry.subscribers.delete(id)
    } else {
      subscriber.send('workspace-files:changed', payload)
    }
  }
}

function queueChange(projectRoot: string, entry: WorkspaceWatcher, changedPath: string) {
  if (entry.changedPaths.size < WATCH_BATCH_PATH_LIMIT) {
    const relative = path.relative(projectRoot, changedPath).replaceAll('\\', '/')
    if (relative && relative !== '..' && !relative.startsWith('../')) {
      entry.changedPaths.add(relative)
    }
  } else {
    entry.overflow = true
  }
  if (entry.timeout) clearTimeout(entry.timeout)
  entry.timeout = setTimeout(() => flush(projectRoot, entry), WATCH_COALESCE_MS)
}

function queueOverflow(projectRoot: string, entry: WorkspaceWatcher, error: unknown) {
  logger.warn('Workspace file watcher reported an error', {
    projectRoot,
    error: error instanceof Error ? error.message : String(error),
  })
  entry.overflow = true
  if (entry.timeout) clearTimeout(entry.timeout)
  entry.timeout = setTimeout(() => flush(projectRoot, entry), WATCH_COALESCE_MS)
}

function waitForWatcherReady(watcher: FSWatcher): Promise<void> {
  return new Promise((resolve, reject) => {
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
}

async function closeWatcher(entry: WorkspaceWatcher) {
  if (entry.timeout) clearTimeout(entry.timeout)
  await entry.watcher.close()
  entry.watcher.removeListener('error', entry.onRuntimeError)
}

async function createWatcher(projectRoot: string, subscribers: Map<number, WebContents>) {
  const watcher = watch(projectRoot, {
    ignoreInitial: true,
    ignored,
    followSymlinks: false,
    awaitWriteFinish: {
      stabilityThreshold: WATCH_COALESCE_MS,
      pollInterval: WATCH_POLL_INTERVAL_MS,
    },
  })
  const entry: WorkspaceWatcher = {
    watcher,
    subscribers,
    changedPaths: new Set(),
    timeout: null,
    overflow: false,
    onRuntimeError: (error) => queueOverflow(projectRoot, entry, error),
  }
  const onChange = (_eventName: string, changedPath: string) =>
    queueChange(projectRoot, entry, changedPath)
  watcher.on('all', onChange)
  try {
    await waitForWatcherReady(watcher)
  } catch (error) {
    watcher.removeListener('all', onChange)
    await watcher.close().catch(() => undefined)
    throw error
  }
  watcher.on('error', entry.onRuntimeError)
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
