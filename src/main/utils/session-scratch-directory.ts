import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { env } from '../env'

const SCRATCH_DIRECTORY_MODE = 0o700
const PERMISSION_BITS = 0o777
const SCRATCH_ROOT_NAME = 'ow-scratch'
const SCRATCH_NAME_HASH_CHARACTERS = 12
const NAMESPACE_HASH_CHARACTERS = 8
const HOUR_MS = 60 * 60 * 1000
/** A directory this young may belong to a Session created after the sweep read the catalog. */
const SWEEP_MINIMUM_AGE_MS = HOUR_MS
/** Another profile's namespace untouched this long belongs to a profile that no longer runs. */
const ABANDONED_NAMESPACE_AGE_MS = 7 * 24 * HOUR_MS
const DEFAULT_NAMESPACE_SOURCE = 'default'
/**
 * A Unix socket path must fit in 104 bytes on macOS. Tools such as `tsx` (`/tsx-<uid>/<pid>.pipe`)
 * and Chromium (`/.com.google.Chrome.XXXXXX/SingletonSocket`, 43 bytes) bind sockets under
 * `TMPDIR`, so the scratch directory path stays within this budget to leave room for them. Under
 * the macOS per-user temp directory (`/var/folders/...`, 48 bytes on its own) it would not fit, so
 * there the scratch root falls back to the short `/tmp`.
 */
const MAX_SCRATCH_DIRECTORY_PATH_BYTES = 56
const POSIX_SHORT_SCRATCH_BASE = '/tmp'
/** The Host's own temp directory, kept for tool processes whose `TMPDIR` points at a scratch dir. */
export const HOST_TEMPORARY_DIRECTORY_ENV = 'OPENWAGGLE_HOST_TMPDIR' satisfies keyof typeof env

interface ScratchDirectoryState {
  /** Runs currently using the directory. */
  retained: number
  /** Archive or delete arrived while a Run was still using the directory. */
  removeWhenReleased: boolean
  /** A removal still in flight, so a run that starts right after unarchive waits for it. */
  removal: Promise<void> | undefined
}

const scratchDirectoryStates = new Map<string, ScratchDirectoryState>()

function shortHash(value: string, characters: number) {
  return createHash('sha256').update(value).digest('hex').slice(0, characters)
}

let scratchNamespace = shortHash(DEFAULT_NAMESPACE_SOURCE, NAMESPACE_HASH_CHARACTERS)

/**
 * Give this Host's scratch directories their own parent. Every OpenWaggle profile (the app, each
 * dev profile) has its own Host and Session catalog but shares `/tmp`, so without a namespace one
 * Host's sweep would delete another Host's live directories.
 */
export function configureSessionScratchNamespace(userDataRoot: string) {
  scratchNamespace = shortHash(path.resolve(userDataRoot), NAMESPACE_HASH_CHARACTERS)
}

function scratchDirectoryState(directory: string) {
  const existing = scratchDirectoryStates.get(directory)
  if (existing) return existing
  const created: ScratchDirectoryState = {
    retained: 0,
    removeWhenReleased: false,
    removal: undefined,
  }
  scratchDirectoryStates.set(directory, created)
  return created
}

function forgetIdleState(directory: string, state: ScratchDirectoryState) {
  if (state.retained === 0 && !state.removeWhenReleased && state.removal === undefined) {
    scratchDirectoryStates.delete(directory)
  }
}

/**
 * The temp directory the Host itself uses. Inside an agent tool process `TMPDIR` is the Session
 * scratch directory, so code that must agree with the Host on a temp path (the Session Host
 * socket fallback) reads the preserved value instead.
 */
export function hostTemporaryDirectory(preserved = env.OPENWAGGLE_HOST_TMPDIR) {
  return preserved || os.tmpdir()
}

function scratchUserDirectoryName() {
  const uid = process.getuid?.()
  return uid === undefined ? SCRATCH_ROOT_NAME : `${SCRATCH_ROOT_NAME}-${uid}`
}

function rootUnder(temporaryDirectory: string) {
  return path.join(temporaryDirectory, scratchUserDirectoryName(), scratchNamespace)
}

/**
 * The user's temp directory when a scratch path under it fits the socket budget, as on Linux or
 * with a short custom `TMPDIR` (for example one chosen because `/tmp` is `noexec`), and `/tmp`
 * otherwise. Windows has no Unix socket limit and always uses the user temp directory.
 */
export function defaultScratchBase(temporaryDirectory = hostTemporaryDirectory()) {
  if (process.platform === 'win32') return temporaryDirectory
  const sample = path.join(rootUnder(temporaryDirectory), 'x'.repeat(SCRATCH_NAME_HASH_CHARACTERS))
  return Buffer.byteLength(sample, 'utf8') <= MAX_SCRATCH_DIRECTORY_PATH_BYTES
    ? temporaryDirectory
    : POSIX_SHORT_SCRATCH_BASE
}

/**
 * This Host's parent of every Session scratch directory. Every level is created owner-only and
 * refused if it is a symlink or owned by another user, so another local account can at most
 * block it, never read it.
 */
export function sessionScratchRoot(temporaryDirectory = defaultScratchBase()) {
  return rootUnder(temporaryDirectory)
}

export function sessionScratchDirectoryPath(sessionId: string, root = sessionScratchRoot()) {
  if (sessionId.length === 0) throw new Error('Session id is required for a scratch directory')
  return path.join(root, shortHash(sessionId, SCRATCH_NAME_HASH_CHARACTERS))
}

function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

async function ensurePrivateDirectory(directory: string) {
  try {
    await fs.mkdir(directory, { mode: SCRATCH_DIRECTORY_MODE })
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error
  }
  const stats = await fs.lstat(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Scratch directory is not a real directory: ${directory}`)
  }
  const uid = process.getuid?.()
  if (uid !== undefined && stats.uid !== uid) {
    throw new Error(`Scratch directory is owned by another user: ${directory}`)
  }
  if (process.platform !== 'win32' && (stats.mode & PERMISSION_BITS) !== SCRATCH_DIRECTORY_MODE) {
    await fs.chmod(directory, SCRATCH_DIRECTORY_MODE)
  }
}

/**
 * Create the Session's private scratch directory. Each Session, Worker or not, gets its own, so
 * concurrent agents that pick the same literal file name cannot read or overwrite each other's
 * files. A removal still in flight finishes first; its failure is the remover's to report.
 */
export async function prepareSessionScratchDirectory(
  sessionId: string,
  root = sessionScratchRoot(),
) {
  const directory = sessionScratchDirectoryPath(sessionId, root)
  const state = scratchDirectoryState(directory)
  await state.removal?.catch(() => undefined)
  forgetIdleState(directory, state)
  await ensurePrivateDirectory(path.dirname(root))
  await ensurePrivateDirectory(root)
  await ensurePrivateDirectory(directory)
  // Sweeps judge age by modification time, so each Run marks its directory and namespace as used.
  const touchedAt = new Date()
  await Promise.all([
    fs.utimes(root, touchedAt, touchedAt),
    fs.utimes(directory, touchedAt, touchedAt),
  ])
  return directory
}

function removeNow(directory: string, state: ScratchDirectoryState) {
  // A failed earlier removal must not cancel this one.
  const previous = state.removal?.catch(() => undefined) ?? Promise.resolve()
  const removal: Promise<void> = previous
    .then(() => fs.rm(directory, { recursive: true, force: true }))
    .finally(() => {
      if (state.removal === removal) state.removal = undefined
      forgetIdleState(directory, state)
    })
  state.removal = removal
  return removal
}

/**
 * Mark the directory as in use by a Run until the returned release runs. An archive or delete that
 * arrives meanwhile is deferred to the release, so a Run's temp files do not vanish under it.
 */
export function retainSessionScratchDirectory(sessionId: string, root = sessionScratchRoot()) {
  const directory = sessionScratchDirectoryPath(sessionId, root)
  const state = scratchDirectoryState(directory)
  state.retained += 1
  let released = false
  return async () => {
    if (released) return
    released = true
    state.retained -= 1
    if (state.retained > 0) return
    if (state.removeWhenReleased) {
      state.removeWhenReleased = false
      await removeNow(directory, state)
      return
    }
    forgetIdleState(directory, state)
  }
}

/**
 * The Session was unarchived, so a removal its archive deferred to the end of a running Run no
 * longer applies. Deleted Sessions are never restored, so only unarchive calls this.
 */
export function keepSessionScratchDirectory(sessionId: string, root = sessionScratchRoot()) {
  const directory = sessionScratchDirectoryPath(sessionId, root)
  const state = scratchDirectoryStates.get(directory)
  if (!state) return
  state.removeWhenReleased = false
  forgetIdleState(directory, state)
}

export async function removeSessionScratchDirectory(
  sessionId: string,
  root = sessionScratchRoot(),
) {
  const directory = sessionScratchDirectoryPath(sessionId, root)
  const state = scratchDirectoryState(directory)
  if (state.retained > 0) {
    state.removeWhenReleased = true
    return
  }
  await removeNow(directory, state)
}

async function isOwnedPrivateDirectory(directory: string) {
  const stats = await fs.lstat(directory)
  const uid = process.getuid?.()
  return stats.isDirectory() && !stats.isSymbolicLink() && (uid === undefined || stats.uid === uid)
}

async function newestModification(directory: string) {
  const stats = await fs.lstat(directory)
  let newest = stats.mtimeMs
  for (const name of await fs.readdir(directory)) {
    const child = await fs.lstat(path.join(directory, name)).catch(() => undefined)
    if (child) newest = Math.max(newest, child.mtimeMs)
  }
  return newest
}

/**
 * Remove other profiles' namespaces that nothing has touched for a week. Throwaway profiles such
 * as `pnpm dev:debug` runs get a fresh namespace each time and no Host ever sweeps it again.
 */
async function sweepAbandonedNamespaces(root: string, now: number) {
  const userDirectory = path.dirname(root)
  const ownNamespace = path.basename(root)
  let removed = 0
  for (const name of await fs.readdir(userDirectory)) {
    if (name === ownNamespace) continue
    const namespace = path.join(userDirectory, name)
    if (!(await isOwnedPrivateDirectory(namespace).catch(() => false))) continue
    const newest = await newestModification(namespace).catch(() => now)
    if (now - newest < ABANDONED_NAMESPACE_AGE_MS) continue
    await fs.rm(namespace, { recursive: true, force: true })
    removed += 1
  }
  return removed
}

/**
 * Remove scratch directories whose Session is gone or archived. Archive and delete remove the
 * directory while the Host runs; this catches Sessions deleted while it was down or left behind by
 * a failed removal. Directories in use by a Run, or too young to rule out a new Session, are kept.
 * Other profiles' namespaces are removed only once abandoned for a week. Returns the number of
 * directories removed.
 */
export async function sweepSessionScratchDirectories(
  liveSessionIds: Iterable<string>,
  root = sessionScratchRoot(),
  now = Date.now(),
) {
  const live = new Set(
    Array.from(liveSessionIds, (sessionId) =>
      path.basename(sessionScratchDirectoryPath(sessionId, root)),
    ),
  )
  let entries: string[]
  try {
    if (!(await isOwnedPrivateDirectory(path.dirname(root)))) return 0
    entries = (await isOwnedPrivateDirectory(root).catch(() => false)) ? await fs.readdir(root) : []
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return 0
    throw error
  }
  let removed = 0
  for (const name of entries) {
    if (live.has(name)) continue
    const directory = path.join(root, name)
    const stats = await fs.lstat(directory).catch(() => undefined)
    if (!stats?.isDirectory() || stats.isSymbolicLink()) continue
    if (now - stats.mtimeMs < SWEEP_MINIMUM_AGE_MS) continue
    // Checked after the awaits and right before starting the removal, in the same tick, so a Run
    // that retained the directory meanwhile keeps it; a later Run waits for the removal instead.
    const state = scratchDirectoryState(directory)
    if (state.retained > 0) {
      forgetIdleState(directory, state)
      continue
    }
    await removeNow(directory, state)
    removed += 1
  }
  return removed + (await sweepAbandonedNamespaces(root, now))
}

/**
 * Temp-directory variables for a tool process. `mktemp`, `os.tmpdir()`, Python's `tempfile`, and
 * most CLIs read one of these, so their temp files land in the Session scratch directory. The
 * Host's own temp directory is kept alongside so an `openwaggle` CLI run by the agent still finds
 * a Session Host socket that fell back to it.
 */
export function sessionScratchEnvironment(directory: string): Readonly<Record<string, string>> {
  return {
    TMPDIR: directory,
    TMP: directory,
    TEMP: directory,
    [HOST_TEMPORARY_DIRECTORY_ENV]: hostTemporaryDirectory(),
  }
}
