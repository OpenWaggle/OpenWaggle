import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const SCRATCH_DIRECTORY_MODE = 0o700
const PERMISSION_BITS = 0o777
const SCRATCH_ROOT_NAME = 'openwaggle-scratch'
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Removals still in flight, so a run that starts right after unarchive waits for them. */
const pendingRemovals = new Map<string, Promise<void>>()

/**
 * The per-user parent of every Session scratch directory. On a shared `/tmp` the user id in the
 * name keeps another local account from pre-creating the parent; ownership is still verified.
 */
export function sessionScratchRoot(temporaryDirectory = os.tmpdir()) {
  const uid = process.getuid?.()
  return path.join(
    temporaryDirectory,
    uid === undefined ? SCRATCH_ROOT_NAME : `${SCRATCH_ROOT_NAME}-${uid}`,
  )
}

export function sessionScratchDirectoryPath(sessionId: string, root = sessionScratchRoot()) {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Session id is not a valid scratch directory name: ${sessionId}`)
  }
  return path.join(root, sessionId)
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
 * files.
 */
export async function prepareSessionScratchDirectory(
  sessionId: string,
  root = sessionScratchRoot(),
) {
  const directory = sessionScratchDirectoryPath(sessionId, root)
  await pendingRemovals.get(directory)
  await ensurePrivateDirectory(root)
  await ensurePrivateDirectory(directory)
  return directory
}

export async function removeSessionScratchDirectory(
  sessionId: string,
  root = sessionScratchRoot(),
) {
  const directory = sessionScratchDirectoryPath(sessionId, root)
  const previous = pendingRemovals.get(directory) ?? Promise.resolve()
  const removal = previous
    .then(() => fs.rm(directory, { recursive: true, force: true }))
    .finally(() => {
      if (pendingRemovals.get(directory) === removal) pendingRemovals.delete(directory)
    })
  pendingRemovals.set(directory, removal)
  await removal
}

/**
 * Temp-directory variables for a tool process. `mktemp`, `os.tmpdir()`, Python's `tempfile`, and
 * most CLIs read one of these, so their temp files land in the Session scratch directory.
 */
export function sessionScratchEnvironment(directory: string): Readonly<Record<string, string>> {
  return { TMPDIR: directory, TMP: directory, TEMP: directory }
}
