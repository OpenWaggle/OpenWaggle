import { existsSync, lstatSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  deletedCreatedPiSessionFileMessage,
  deletedPiSessionFileMessage,
  unavailablePiSessionFileMessage,
} from '@shared/domain/pi-session-file-messages'
import type { SessionDetail } from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'

/** A Session's Pi file cannot be used, so nothing is started in its place. */
export class PiSessionFileUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PiSessionFileUnavailableError'
  }
}

/** Whether the projection holds what a Pi file held: a discovered Session, or any projected entry. */
export function hasProjectedEntries(session: SessionDetail) {
  return (
    session.piEntryNodeIdPrefix !== undefined ||
    (session.resumePosition?.piEntryCount ?? 0) > 0 ||
    session.messages.length > 0
  )
}

/**
 * Whether a Pi file that could not be found is out of reach rather than deleted: its folder is
 * missing, it is a link whose target is missing, or it may not be read.
 */
function outOfReach(file: string) {
  try {
    lstatSync(file)
    // Something is there, which `existsSync` could not follow or read.
    return true
  } catch (cause) {
    const code = isRecord(cause) ? cause.code : undefined
    return code !== 'ENOENT' || !existsSync(dirname(file))
  }
}

/** What needs the Session's Pi file, as the message names it: `forking`, `compacting`. */
export type PiSessionFileAction = 'forking' | 'compacting'

/**
 * Why the Session's Pi file, which could not be found, cannot be used for `action`: its folder is
 * missing, or the file was deleted from it. A discovered Session cannot be continued then; one
 * OpenWaggle created starts a new transcript with its next message.
 */
export function missingPiSessionFileError(session: SessionDetail, action?: PiSessionFileAction) {
  const file = session.piSessionFile?.trim() || `the Pi session file of ${String(session.id)}`
  if (outOfReach(file)) {
    return new PiSessionFileUnavailableError(unavailablePiSessionFileMessage(file))
  }
  return new PiSessionFileUnavailableError(
    session.piEntryNodeIdPrefix === undefined
      ? deletedCreatedPiSessionFileMessage(file, action)
      : deletedPiSessionFileMessage(file),
  )
}

/**
 * Throws when the Session's Pi file cannot be found and a new one under the same Pi session id
 * would replace the history the Session shows (ADR 0051):
 *
 * - a discovered Session, whose history is its Pi file: deleted, or out of reach;
 * - any Session with projected entries whose file's folder is missing, as when it was renamed
 *   away or is on a drive that is not connected. Starting a file would also create the folder.
 *
 * A Session OpenWaggle created whose file was deleted while its folder is there still starts a
 * new transcript.
 */
export function assertNoPiSessionFileToReplace(session: SessionDetail) {
  const file = session.piSessionFile?.trim()
  if (!file || !hasProjectedEntries(session)) return
  const folderMissing = outOfReach(file)
  if (folderMissing) {
    throw new PiSessionFileUnavailableError(unavailablePiSessionFileMessage(file))
  }
  if (session.piEntryNodeIdPrefix !== undefined) {
    throw new PiSessionFileUnavailableError(
      folderMissing ? unavailablePiSessionFileMessage(file) : deletedPiSessionFileMessage(file),
    )
  }
}
