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
/** A directory this young may belong to a Session created after the sweep read the catalog. */
const SWEEP_MINIMUM_AGE_MS = 60 * 60 * 1000
const DEFAULT_NAMESPACE_SOURCE = 'default'
/**
 * `os.tmpdir()` on macOS is a 48-byte `/var/folders/...` path, and a Unix socket path must fit in
 * 104 bytes. Tools such as `tsx` bind sockets under `TMPDIR`, so the scratch directory lives under
 * the short `/tmp` instead and keeps a hashed, fixed-length name.
 */
const POSIX_SCRATCH_BASE = '/tmp'
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

function defaultScratchBase() {
  return process.platform === 'win32' ? os.tmpdir() : POSIX_SCRATCH_BASE
}

function scratchUserDirectoryName() {
  const uid = process.getuid?.()
  return uid === undefined ? SCRATCH_ROOT_NAME : `${SCRATCH_ROOT_NAME}-${uid}`
}

/**
 * This Host's parent of every Session scratch directory. On a shared `/tmp` the user id in the
 * name keeps another local account from pre-creating it; ownership is still verified.
 */
export function sessionScratchRoot(temporaryDirectory = defaultScratchBase()) {
  return path.join(temporaryDirectory, scratchUserDirectoryName(), scratchNamespace)
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
 * files. A new Run means the Session is live again, so a removal deferred by archive is dropped.
 */
export async function prepareSessionScratchDirectory(
  sessionId: string,
  root = sessionScratchRoot(),
) {
  const directory = sessionScratchDirectoryPath(sessionId, root)
  const state = scratchDirectoryState(directory)
  state.removeWhenReleased = false
  await state.removal
  forgetIdleState(directory, state)
  await ensurePrivateDirectory(path.dirname(root))
  await ensurePrivateDirectory(root)
  await ensurePrivateDirectory(directory)
  return directory
}

function removeNow(directory: string, state: ScratchDirectoryState) {
  const previous = state.removal ?? Promise.resolve()
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

/**
 * Remove scratch directories whose Session is gone or archived. Archive and delete remove the
 * directory while the Host runs; this catches Sessions deleted while it was down or left behind by
 * a failed removal. Directories in use by a Run, or too young to rule out a new Session, are kept.
 * Returns the number removed.
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
    if (!(await isOwnedPrivateDirectory(root))) return 0
    entries = await fs.readdir(root)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return 0
    throw error
  }
  let removed = 0
  for (const name of entries) {
    if (live.has(name)) continue
    const directory = path.join(root, name)
    const state = scratchDirectoryStates.get(directory)
    if (state && state.retained > 0) continue
    const stats = await fs.lstat(directory).catch(() => undefined)
    if (!stats?.isDirectory() || stats.isSymbolicLink()) continue
    if (now - stats.mtimeMs < SWEEP_MINIMUM_AGE_MS) continue
    await removeNow(directory, state ?? scratchDirectoryState(directory))
    removed += 1
  }
  return removed
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
