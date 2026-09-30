import fs from 'node:fs/promises'
import path from 'node:path'
import { ensurePrivateDirectory, sessionScratchRoot } from './session-scratch-directory'

/** Sits beside the profile namespaces in the per-user scratch directory. */
export const SESSION_EVIDENCE_DIRECTORY_NAME = 'evidence'
/** The tool environment variable that names a Session's evidence directory. */
export const SESSION_EVIDENCE_DIRECTORY_ENV = 'OPENWAGGLE_EVIDENCE_DIR'

/**
 * Where Sessions keep files they show the user or another Session, such as QA screenshots:
 * `<base>/ow-scratch-<uid>/evidence`. Unlike the scratch directory it survives archiving, so a
 * Queen can still render the screenshots of a Worker that cleanup archived (ADR 0042). It is
 * private to the user, and every Session of that user may capture images from it, as they could
 * from the shared temp directory before scratch directories existed.
 */
export function sessionEvidenceRoot(scratchRoot = sessionScratchRoot()) {
  return path.join(path.dirname(scratchRoot), SESSION_EVIDENCE_DIRECTORY_NAME)
}

/** A Session's evidence directory, named like its scratch directory. */
export function sessionEvidenceDirectoryFor(scratchDirectory: string) {
  return path.join(
    sessionEvidenceRoot(path.dirname(scratchDirectory)),
    path.basename(scratchDirectory),
  )
}

/** Create the Session's evidence directory owner-only at every level, and mark it as used. */
export async function prepareSessionEvidenceDirectory(scratchDirectory: string) {
  const directory = sessionEvidenceDirectoryFor(scratchDirectory)
  const root = path.dirname(directory)
  await ensurePrivateDirectory(path.dirname(root))
  await ensurePrivateDirectory(root)
  await ensurePrivateDirectory(directory)
  const touchedAt = new Date()
  await fs.utimes(directory, touchedAt, touchedAt)
  return directory
}
