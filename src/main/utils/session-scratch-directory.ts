import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { env } from '../env'

const SCRATCH_DIRECTORY_MODE = 0o700
const PERMISSION_BITS = 0o777
const SCRATCH_ROOT_NAME = 'ow-scratch'
const SCRATCH_NAME_HASH_CHARACTERS = 16
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

/**
 * The per-user parent of every Session scratch directory. On a shared `/tmp` the user id in the
 * name keeps another local account from pre-creating the parent; ownership is still verified.
 */
export function sessionScratchRoot(temporaryDirectory = defaultScratchBase()) {
  const uid = process.getuid?.()
  return path.join(
    temporaryDirectory,
    uid === undefined ? SCRATCH_ROOT_NAME : `${SCRATCH_ROOT_NAME}-${uid}`,
  )
}

export function sessionScratchDirectoryPath(sessionId: string, root = sessionScratchRoot()) {
  if (sessionId.length === 0) throw new Error('Session id is required for a scratch directory')
  const name = createHash('sha256')
    .update(sessionId)
    .digest('hex')
    .slice(0, SCRATCH_NAME_HASH_CHARACTERS)
  return path.join(root, name)
}

function isAlreadyExists(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

async function ensurePrivateDirectory(directory: string) {
  try {
    await fs.mkdir(directory, { mode: SCRATCH_DIRECTORY_MODE })
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
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
