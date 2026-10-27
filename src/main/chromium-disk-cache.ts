import fs from 'node:fs/promises'
import path from 'node:path'
import type { CommandLine, Session } from 'electron'
import { createLogger } from './logger'

const logger = createLogger('chromium-disk-cache')

const MEBIBYTE = 1024 * 1024
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/**
 * Most bytes one Chromium session keeps in its HTTP cache. Unbounded, Chromium sizes it from the
 * free disk space: 1.2 GB in the default session and 853 MB in the browser preview partition were
 * observed.
 */
export const CHROMIUM_HTTP_CACHE_MAX_BYTES = 256 * MEBIBYTE
/**
 * Most bytes of V8 code cache a session keeps before it is cleared; Chromium does not bound it by
 * the switch above. The app's own scripts need a small part of it.
 */
export const CHROMIUM_CODE_CACHE_MAX_BYTES = 256 * MEBIBYTE
/** Off the startup path: the first check waits this long after a session is first used. */
const FIRST_CACHE_CHECK_DELAY_MS = MINUTE_MS
/** A long-lived window keeps checking, since the code cache only grows. */
const CACHE_CHECK_INTERVAL_MS = 6 * HOUR_MS

const DISK_CACHE_SIZE_SWITCH = 'disk-cache-size'
const CODE_CACHE_DIRECTORY_NAME = 'Code Cache'

/**
 * Cap the HTTP disk cache of every Chromium session this process opens. Must run before the app is
 * ready; an explicit `--disk-cache-size` given on the command line wins.
 */
export function limitChromiumHttpDiskCache(
  commandLine: Pick<CommandLine, 'appendSwitch' | 'hasSwitch'>,
) {
  if (commandLine.hasSwitch(DISK_CACHE_SIZE_SWITCH)) return
  commandLine.appendSwitch(DISK_CACHE_SIZE_SWITCH, String(CHROMIUM_HTTP_CACHE_MAX_BYTES))
}

export interface ChromiumCacheSizes {
  readonly httpCacheBytes: number
  readonly codeCacheBytes: number
}

/**
 * Which caches to clear. The capped HTTP cache stays under its cap, so one above it was filled
 * before the cap applied and is cleared once.
 */
export function oversizedChromiumCaches(sizes: ChromiumCacheSizes) {
  return {
    httpCache: sizes.httpCacheBytes > CHROMIUM_HTTP_CACHE_MAX_BYTES,
    codeCache: sizes.codeCacheBytes > CHROMIUM_CODE_CACHE_MAX_BYTES,
  }
}

/** Bytes of the regular files under `directory`, without following symbolic links. */
export async function directorySizeBytes(directory: string): Promise<number> {
  let total = 0
  const pending = [directory]
  while (true) {
    const current = pending.pop()
    if (current === undefined) return total
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(entryPath)
        continue
      }
      if (entry.isFile()) total += (await fs.lstat(entryPath).catch(() => undefined))?.size ?? 0
    }
  }
}

export type ChromiumCacheSession = Pick<
  Session,
  'clearCache' | 'clearCodeCaches' | 'getCacheSize' | 'isPersistent' | 'storagePath'
>

export interface ChromiumCacheTrimResult {
  readonly clearedHttpCacheBytes: number
  readonly clearedCodeCacheBytes: number
}

/** Clear a persistent session's HTTP or code cache when it is over its bound. */
export async function trimChromiumCachesIfOversized(
  session: ChromiumCacheSession,
  measureDirectory: (directory: string) => Promise<number> = directorySizeBytes,
): Promise<ChromiumCacheTrimResult> {
  const storagePath = session.storagePath
  if (!session.isPersistent() || storagePath === null) {
    return { clearedHttpCacheBytes: 0, clearedCodeCacheBytes: 0 }
  }
  const sizes = {
    httpCacheBytes: await session.getCacheSize(),
    codeCacheBytes: await measureDirectory(path.join(storagePath, CODE_CACHE_DIRECTORY_NAME)),
  }
  const oversized = oversizedChromiumCaches(sizes)
  if (oversized.httpCache) await session.clearCache()
  if (oversized.codeCache) await session.clearCodeCaches({})
  return {
    clearedHttpCacheBytes: oversized.httpCache ? sizes.httpCacheBytes : 0,
    clearedCodeCacheBytes: oversized.codeCache ? sizes.codeCacheBytes : 0,
  }
}

const watchedSessions = new WeakSet<ChromiumCacheSession>()

async function trimAndLog(session: ChromiumCacheSession) {
  try {
    const result = await trimChromiumCachesIfOversized(session)
    if (result.clearedHttpCacheBytes > 0 || result.clearedCodeCacheBytes > 0) {
      logger.info('Cleared an oversized Chromium cache', {
        storagePath: session.storagePath,
        ...result,
      })
    }
  } catch (error) {
    logger.warn('Chromium cache check failed', { error: String(error) })
  }
}

/**
 * Keep a session's caches bounded for as long as this process runs: a first check shortly after
 * it is first used, then one every few hours. Idempotent per session; the timers never keep the
 * process alive.
 */
export function watchChromiumCacheSize(
  session: ChromiumCacheSession,
  timing: { readonly firstCheckDelayMs?: number; readonly intervalMs?: number } = {},
) {
  if (watchedSessions.has(session)) return
  watchedSessions.add(session)
  const intervalMs = timing.intervalMs ?? CACHE_CHECK_INTERVAL_MS
  setTimeout(() => {
    void trimAndLog(session)
    setInterval(() => void trimAndLog(session), intervalMs).unref()
  }, timing.firstCheckDelayMs ?? FIRST_CACHE_CHECK_DELAY_MS).unref()
}
