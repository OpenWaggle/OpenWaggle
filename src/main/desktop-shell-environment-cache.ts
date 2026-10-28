import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import { isEnoent } from '@shared/utils/node-error'
import {
  LOGIN_SHELL_ENV_NAMES,
  type ShellEnvironmentPatch,
} from './desktop-shell-environment-probes'
import { createLogger } from './logger'

const logger = createLogger('desktop-shell-environment')

const CACHE_VERSION = 1 as const
const CACHE_FILE_NAME = 'shell-environment.json'
/** Older than this, a cached login-shell environment is not used, only refreshed. */
export const SHELL_ENVIRONMENT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const PRIVATE_FILE_MODE = 0o600

/** The profile's cache file, shared by its desktop window and its Session Host. */
export function shellEnvironmentCacheFile(userDataRoot: string) {
  return join(userDataRoot, CACHE_FILE_NAME)
}

/** Whose login shell a cached environment came from. */
export interface ShellEnvironmentCacheKey {
  readonly platform: NodeJS.Platform
  readonly shell: string
  readonly home: string
}

/** What one login-shell probe found: its allowlisted variables, and launchd's PATH on macOS. */
export interface ResolvedShellEnvironment {
  readonly environment: ShellEnvironmentPatch
  readonly launchctlPath?: string
}

/** A cached result and when its probe ran (epoch ms). */
export interface CachedShellEnvironment extends ResolvedShellEnvironment {
  readonly resolvedAt: number
}

export interface ShellEnvironmentCache {
  readonly read: (key: ShellEnvironmentCacheKey, now: number) => CachedShellEnvironment | null
  readonly write: (
    key: ShellEnvironmentCacheKey,
    resolved: ResolvedShellEnvironment,
    now: number,
  ) => void
  /**
   * Records that a refresh ran at `now` and found nothing, keeping the last good result, so a
   * Host waiting for that refresh (`refreshedElsewhere`) stops waiting and probes itself.
   */
  readonly markRefreshFailed: (key: ShellEnvironmentCacheKey, now: number) => void
  /** When the last refresh for `key` found nothing (epoch ms); null if the last one succeeded. */
  readonly refreshFailedAt: (key: ShellEnvironmentCacheKey) => number | null
}

const cacheFileSchema = Schema.Struct({
  version: Schema.Literal(CACHE_VERSION),
  platform: Schema.String,
  shell: Schema.String,
  home: Schema.String,
  resolvedAt: Schema.Number,
  environment: Schema.Record({ key: Schema.String, value: Schema.String }),
  launchctlPath: Schema.optional(Schema.String),
  refreshFailedAt: Schema.optional(Schema.Number),
})

type CacheFileEntry = typeof cacheFileSchema.Type

/** Only the probe's allowlisted names are ever read from or written to disk. */
function allowlisted(environment: Readonly<Record<string, string>>): ShellEnvironmentPatch {
  // Read on use: `env.ts` loads this module while the probes module may still be initializing.
  const names = new Set<string>(LOGIN_SHELL_ENV_NAMES)
  return Object.fromEntries(Object.entries(environment).filter(([name]) => names.has(name)))
}

function sameKey(
  entry: { readonly platform: string; readonly shell: string; readonly home: string },
  key: ShellEnvironmentCacheKey,
) {
  return entry.platform === key.platform && entry.shell === key.shell && entry.home === key.home
}

function readCacheFile(file: string) {
  try {
    return parseJsonUnknown(readFileSync(file, 'utf8'))
  } catch (error) {
    if (!isEnoent(error)) {
      logger.warn('The cached login-shell environment could not be read', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return null
  }
}

function writeCacheFile(file: string, entry: CacheFileEntry) {
  const temporary = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temporary, `${JSON.stringify(entry)}\n`, { mode: PRIVATE_FILE_MODE })
    // The GUI and the Host both refresh it; a rename never leaves a half-written file.
    renameSync(temporary, file)
  } catch (error) {
    logger.warn('The login-shell environment could not be cached', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function decodeCacheFile(file: string): CacheFileEntry | null {
  const raw = readCacheFile(file)
  if (raw === null) return null
  const decoded = safeDecodeUnknown(cacheFileSchema, raw)
  if (!decoded.success) {
    logger.warn('Ignoring a malformed cached login-shell environment', {
      issues: decoded.issues,
    })
    return null
  }
  return decoded.data
}

/**
 * The last login-shell environment, kept in one private file per profile (like VS Code's resolved
 * shell environment), so a launch uses it at once while the probe refreshes it. Only the probe's
 * allowlisted variables are kept (PATH, the SSH agent socket, locale, desktop session); never a
 * secret the shell exports.
 */
export function fileShellEnvironmentCache(file: string): ShellEnvironmentCache {
  return {
    read: (key, now) => {
      const entry = decodeCacheFile(file)
      if (!entry) return null
      if (!sameKey(entry, key) || now - entry.resolvedAt > SHELL_ENVIRONMENT_CACHE_MAX_AGE_MS) {
        return null
      }
      return {
        environment: allowlisted(entry.environment),
        ...(entry.launchctlPath === undefined ? {} : { launchctlPath: entry.launchctlPath }),
        resolvedAt: entry.resolvedAt,
      }
    },
    write: (key, resolved, now) => {
      writeCacheFile(file, {
        version: CACHE_VERSION,
        ...key,
        resolvedAt: now,
        environment: allowlisted(resolved.environment),
        ...(resolved.launchctlPath === undefined ? {} : { launchctlPath: resolved.launchctlPath }),
      })
    },
    markRefreshFailed: (key, now) => {
      const entry = decodeCacheFile(file)
      // Without a result for this key, an entry with no environment that `read` treats as
      // expired (`resolvedAt` 0) carries the mark.
      const kept =
        entry && sameKey(entry, key)
          ? entry
          : { version: CACHE_VERSION, ...key, resolvedAt: 0, environment: {} }
      writeCacheFile(file, { ...kept, refreshFailedAt: now })
    },
    refreshFailedAt: (key) => {
      const entry = decodeCacheFile(file)
      return entry && sameKey(entry, key) ? (entry.refreshFailedAt ?? null) : null
    },
  }
}
