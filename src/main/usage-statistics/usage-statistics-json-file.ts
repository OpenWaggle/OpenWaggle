/**
 * One small JSON file with exactly one writing process. Reads happen once, when the file is
 * opened; every change replaces the whole file through a temporary file that is synced to disk
 * before the rename, so a crash leaves either the previous or the next version, never a partial
 * one. A failed write is retried with backoff (Windows antivirus or indexers can hold the file
 * briefly), and {@link UsageStatisticsJsonFile.flush} reports it to callers that must not go on
 * without it. A file that cannot be decoded is logged and replaced by `recover()`, never fatal.
 * Opening the file as its owner deletes temporary files a crash left next to it.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '../logger'

const logger = createLogger('usage-statistics')
const DEFAULT_WRITE_DELAY_MS = 250
const MAX_RETRY_DELAY_MS = 60_000
const RETRY_BACKOFF_FACTOR = 2
const PRIVATE_FILE_MODE = 0o600

export interface UsageStatisticsJsonFile<T> {
  readonly read: () => T
  readonly update: (change: (current: T) => T) => void
  /**
   * Writes any pending change now and resolves once it is on disk. Rejects when it cannot be
   * written; the change stays pending and is retried later.
   */
  readonly flush: () => Promise<void>
  /** Writes any pending change before the process exits. Logs instead of throwing. */
  readonly flushSync: () => void
}

function errorCode(error: unknown) {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

interface LoadInput<T> {
  readonly filePath: string
  readonly label: string
  readonly decode: (value: unknown) => T
  readonly initial: T
  readonly recover: () => T
}

function loadValue<T>(input: LoadInput<T>) {
  let raw: string
  try {
    raw = readFileSync(input.filePath, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { value: input.initial, recovered: false }
    logger.warn('Usage statistics state is unreadable; starting again', {
      file: input.label,
      error: describe(error),
    })
    return { value: input.recover(), recovered: true }
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return { value: input.decode(parsed), recovered: false }
  } catch (error) {
    logger.warn('Usage statistics state is corrupt; starting again', {
      file: input.label,
      error: describe(error),
    })
    return { value: input.recover(), recovered: true }
  }
}

/** Reads a file another process owns. Missing or corrupt files read as `fallback`. */
export function readUsageStatisticsJsonFile<T>(input: {
  readonly filePath: string
  readonly label: string
  readonly decode: (value: unknown) => T
  readonly fallback: T
}): T {
  return loadValue({ ...input, initial: input.fallback, recover: () => input.fallback }).value
}

/**
 * Best effort: makes the rename itself durable. It runs after the rename, so a failure here must
 * not report the write as failed. Windows cannot open a directory for fsync.
 */
async function syncDirectory(directory: string) {
  if (process.platform === 'win32') return
  try {
    const handle = await open(directory, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // Some file systems do not support syncing a directory; the file itself is already synced.
  }
}

/** Temporary files a crash of this file's owner left behind; only the owner may delete them. */
function removeStaleTemporaryFiles(filePath: string, label: string) {
  const directory = path.dirname(filePath)
  const prefix = `${path.basename(filePath)}.`
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue
    try {
      rmSync(path.join(directory, name), { force: true })
    } catch (error) {
      logger.warn('A stale Usage statistics temporary file could not be removed', {
        file: label,
        error: describe(error),
      })
    }
  }
}

async function writeDurably(input: {
  readonly filePath: string
  readonly temporaryPath: string
  readonly serialized: string
  /** Checked just before the rename; false when a newer version was saved meanwhile. */
  readonly stillCurrent: () => boolean
}) {
  await mkdir(path.dirname(input.filePath), { recursive: true })
  const handle = await open(input.temporaryPath, 'w', PRIVATE_FILE_MODE)
  try {
    await handle.writeFile(input.serialized, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  if (!input.stillCurrent()) {
    await rm(input.temporaryPath, { force: true })
    return
  }
  await rename(input.temporaryPath, input.filePath)
  await syncDirectory(path.dirname(input.filePath))
}

function writeDurablySync(filePath: string, temporaryPath: string, serialized: string) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const descriptor = openSync(temporaryPath, 'w', PRIVATE_FILE_MODE)
  try {
    writeSync(descriptor, serialized, null, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  renameSync(temporaryPath, filePath)
}

export function openUsageStatisticsJsonFile<T>(input: {
  readonly filePath: string
  /** Names the file in logs without its path. */
  readonly label: string
  readonly decode: (value: unknown) => T
  /** The value of a file that does not exist yet. */
  readonly initial: T
  /** The value that replaces an unreadable or undecodable file; `initial` when omitted. */
  readonly recover?: () => T
  readonly writeDelayMs?: number
}): UsageStatisticsJsonFile<T> {
  const writeDelayMs = input.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
  removeStaleTemporaryFiles(input.filePath, input.label)
  const loaded = loadValue({ ...input, recover: input.recover ?? (() => input.initial) })
  let current = loaded.value
  // Each change gets a version; a write saves the version it serialized.
  let version = loaded.recovered ? 1 : 0
  let savedVersion = 0
  let failures = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let writing: Promise<void> = Promise.resolve()
  const temporaryPath = `${input.filePath}.${process.pid}.tmp`
  const exitTemporaryPath = `${input.filePath}.${process.pid}.exit.tmp`

  const clearTimer = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
  }

  const schedule = (delayMs: number) => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void flush().catch(() => undefined)
    }, delayMs)
    timer.unref?.()
  }

  const writeCurrent = async () => {
    if (savedVersion >= version) return
    const writtenVersion = version
    try {
      await writeDurably({
        filePath: input.filePath,
        temporaryPath,
        serialized: JSON.stringify(current),
        stillCurrent: () => savedVersion < writtenVersion,
      })
      savedVersion = Math.max(savedVersion, writtenVersion)
      failures = 0
    } catch (error) {
      failures += 1
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      logger.warn('Usage statistics state could not be saved; retrying', {
        file: input.label,
        error: describe(error),
        failures,
      })
      schedule(Math.min(writeDelayMs * RETRY_BACKOFF_FACTOR ** failures, MAX_RETRY_DELAY_MS))
      throw error
    }
  }

  function flush() {
    clearTimer()
    writing = writing.catch(() => undefined).then(writeCurrent)
    return writing
  }

  const flushSync = () => {
    clearTimer()
    if (savedVersion >= version) return
    const writtenVersion = version
    try {
      writeDurablySync(input.filePath, exitTemporaryPath, JSON.stringify(current))
      savedVersion = Math.max(savedVersion, writtenVersion)
    } catch (error) {
      rmSync(exitTemporaryPath, { force: true })
      logger.warn('Usage statistics state could not be saved before exit', {
        file: input.label,
        error: describe(error),
      })
    }
  }

  if (loaded.recovered) schedule(writeDelayMs)

  return {
    read: () => current,
    update: (change) => {
      const next = change(current)
      if (next === current) return
      current = next
      version += 1
      schedule(writeDelayMs)
    },
    flush,
    flushSync,
  }
}
