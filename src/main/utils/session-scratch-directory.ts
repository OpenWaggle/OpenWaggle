import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { env } from '../env'
import { createLogger } from '../logger'

const logger = createLogger('session-scratch-directory')

const SCRATCH_DIRECTORY_MODE = 0o700
const PERMISSION_BITS = 0o777
const SCRATCH_ROOT_NAME = 'ow-scratch'
const SCRATCH_NAME_HASH_CHARACTERS = 12
const NAMESPACE_HASH_CHARACTERS = 8
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
let scratchNamespaceOwner: string | undefined
/** Names the user-data directory a namespace belongs to, so other Hosts know when it is gone. */
export const SCRATCH_NAMESPACE_OWNER_FILE = '.owner'
/** Ends a complete marker, so a marker cut short by a failed write is recognizably incomplete. */
export const SCRATCH_NAMESPACE_OWNER_TERMINATOR = '\n'
const OWNER_FILE_MODE = 0o600

/**
 * Give this Host's scratch directories their own parent. Every OpenWaggle profile (the app, each
 * dev profile) has its own Host and Session catalog but shares `/tmp`, so without a namespace one
 * Host's sweep would delete another Host's live directories.
 */
export function configureSessionScratchNamespace(userDataRoot: string) {
  const previous = scratchNamespace
  const previousOwner = scratchNamespaceOwner
  scratchNamespaceOwner = path.resolve(userDataRoot)
  scratchNamespace = shortHash(scratchNamespaceOwner, NAMESPACE_HASH_CHARACTERS)
  /** Restores the previous namespace; tests use it to leave module state as they found it. */
  return () => {
    scratchNamespace = previous
    scratchNamespaceOwner = previousOwner
  }
}

/**
 * Record which user-data directory owns this namespace. Another profile's Host removes the
 * namespace once that directory is gone, and never while the profile still exists, however long
 * it goes unused.
 */
export async function markSessionScratchNamespace(root = sessionScratchRoot()) {
  const owner = scratchNamespaceOwner
  if (!owner) return
  await ensurePrivateDirectory(path.dirname(root))
  await ensurePrivateDirectory(root)
  // Read every time rather than cached: the namespace may have been removed and recreated since.
  const marker = path.join(root, SCRATCH_NAMESPACE_OWNER_FILE)
  const content = `${owner}${SCRATCH_NAMESPACE_OWNER_TERMINATOR}`
  if ((await fs.readFile(marker, 'utf8').catch(() => undefined)) === content) return
  // Written aside and renamed into place, so a failed write never leaves a partial marker.
  // Unique per call: concurrent prepares of a fresh namespace each write their own pending file.
  const pending = `${marker}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(pending, content, { mode: OWNER_FILE_MODE })
    await fs.rename(pending, marker)
  } catch (error) {
    await fs.rm(pending, { force: true }).catch(() => undefined)
    throw error
  }
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

/** Create `directory` owner-only, refusing a symlink, a non-directory, or another user's directory. */
export async function ensurePrivateDirectory(directory: string) {
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
  // Best effort: an unmarked namespace is only swept after a week unused, so a failed marker
  // write must not cost the Run its scratch directory.
  await markSessionScratchNamespace(root).catch((error: unknown) => {
    logger.warn('Could not mark the session scratch namespace with its owner', {
      root,
      error: String(error),
    })
  })
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

/**
 * Remove a scratch directory unless a Run holds it. Checked and started in the same tick, so a Run
 * that retains it afterwards waits for the removal instead of losing files mid-Run. Resolves
 * whether it was removed; a failed removal resolves false.
 */
export function removeUnretainedScratchDirectory(directory: string) {
  const state = scratchDirectoryState(directory)
  if (state.retained > 0) {
    forgetIdleState(directory, state)
    return Promise.resolve(false)
  }
  return removeNow(directory, state).then(
    () => true,
    () => false,
  )
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
