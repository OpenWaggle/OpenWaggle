import { lstatSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ensurePrivateDirectory, sessionScratchRoot } from './session-scratch-directory'

/** Sits inside the profile namespace, beside the Session scratch directories. */
export const SESSION_EVIDENCE_DIRECTORY_NAME = 'evidence'
/** The tool environment variable that names a Session's evidence directory. */
export const SESSION_EVIDENCE_DIRECTORY_ENV = 'OPENWAGGLE_EVIDENCE_DIR'

/**
 * Where Sessions keep files they show the user or another Session, such as QA screenshots:
 * `<base>/ow-scratch-<uid>/<profile>/evidence`. Unlike the scratch directory it survives
 * archiving, so a Queen can still render the screenshots of a Worker that cleanup archived
 * (ADR 0042). It is private to the user, every Session of the profile may capture images from it,
 * as they could from the shared temp directory before scratch directories existed, and only this
 * profile's Host prunes it.
 */
export function sessionEvidenceRoot(scratchRoot = sessionScratchRoot()) {
  return path.join(scratchRoot, SESSION_EVIDENCE_DIRECTORY_NAME)
}

/** A Session's evidence directory, named like its scratch directory. */
export function sessionEvidenceDirectoryFor(scratchDirectory: string) {
  return path.join(
    sessionEvidenceRoot(path.dirname(scratchDirectory)),
    path.basename(scratchDirectory),
  )
}

/** Evidence directories this process prepared, by the scratch directory they belong to. */
const preparedEvidenceDirectories = new Map<string, string>()
/** Prunes still running, by evidence directory, so a Run that starts meanwhile waits for them. */
const evidenceRemovals = new Map<string, Promise<void>>()

/**
 * Remove a stale evidence directory unless `inUse` says a Run holds its Session. Checked and
 * started in the same tick, and recorded, so a Run preparing it afterwards waits for the removal
 * and recreates it rather than losing it. Resolves whether it was removed.
 */
export function removeStaleEvidenceDirectory(directory: string, inUse: () => boolean) {
  if (inUse()) return Promise.resolve(false)
  const removal = fs.rm(directory, { recursive: true, force: true }).finally(() => {
    if (evidenceRemovals.get(directory) === removal) evidenceRemovals.delete(directory)
  })
  evidenceRemovals.set(directory, removal)
  return removal.then(
    () => true,
    () => false,
  )
}

/** Create the Session's evidence directory owner-only at every level, and mark it as used. */
export async function prepareSessionEvidenceDirectory(scratchDirectory: string) {
  preparedEvidenceDirectories.delete(scratchDirectory)
  const directory = sessionEvidenceDirectoryFor(scratchDirectory)
  await evidenceRemovals.get(directory)?.catch(() => undefined)
  const root = path.dirname(directory)
  await ensurePrivateDirectory(path.dirname(root))
  await ensurePrivateDirectory(root)
  await ensurePrivateDirectory(directory)
  const touchedAt = new Date()
  await fs.utimes(directory, touchedAt, touchedAt)
  preparedEvidenceDirectories.set(scratchDirectory, directory)
  return directory
}

function isRealDirectory(directory: string) {
  try {
    const stats = lstatSync(directory)
    return stats.isDirectory() && !stats.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * The Session's evidence directory if a Run prepared it and it is still a real directory at every
 * level, else undefined. The tool environment and system prompt only name such a directory, so an
 * agent is never pointed at a path that failed its ownership checks.
 */
export function preparedSessionEvidenceDirectory(scratchDirectory: string) {
  const directory = preparedEvidenceDirectories.get(scratchDirectory)
  if (!directory) return undefined
  const root = path.dirname(directory)
  return [path.dirname(root), root, directory].every(isRealDirectory) ? directory : undefined
}
