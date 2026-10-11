import { accessSync, constants, existsSync, lstatSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  deletedCreatedPiSessionFileMessage,
  deletedPiSessionFileMessage,
  type PiSessionFileUnavailability,
  unavailablePiSessionFileMessage,
} from '@shared/domain/pi-session-file-messages'
import type { SessionDetail } from '@shared/types/session'
import { isRecord } from '@shared/utils/validation'
import { logger } from './constants'

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
 * Why a Pi file that could not be found or read is out of reach rather than deleted: its folder
 * is missing (`folder`), or it is a link whose target is missing, or it may not be read (`file`).
 * Undefined when it was deleted from a folder that is there.
 */
function unavailabilityOf(file: string): PiSessionFileUnavailability | undefined {
  try {
    lstatSync(file)
    // Something is there that could not be followed or read.
    return 'file'
  } catch (cause) {
    const code = isRecord(cause) ? cause.code : undefined
    if (code !== 'ENOENT') return 'file'
    return existsSync(dirname(file)) ? undefined : 'folder'
  }
}

/** Whether a Pi file is there and may be read: one that may not is out of reach, not opened. */
export function isReadablePiSessionFile(file: string) {
  try {
    accessSync(file, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/** What needs the Session's Pi file, as the message names it: `forking`, `compacting`. */
export type PiSessionFileAction = 'forking' | 'compacting' | 'going to another branch in'

/**
 * Why the Session's Pi file, which could not be found, cannot be used for `action`: its folder is
 * missing, or the file was deleted from it. A discovered Session cannot be continued then; one
 * OpenWaggle created starts a new transcript with its next message.
 */
export function missingPiSessionFileError(session: SessionDetail, action?: PiSessionFileAction) {
  const file = session.piSessionFile?.trim() || `the Pi session file of ${String(session.id)}`
  const unavailability = unavailabilityOf(file)
  if (unavailability) {
    return new PiSessionFileUnavailableError(unavailablePiSessionFileMessage(file, unavailability))
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
  const unavailability = unavailabilityOf(file)
  if (unavailability) {
    throw new PiSessionFileUnavailableError(unavailablePiSessionFileMessage(file, unavailability))
  }
  if (session.piEntryNodeIdPrefix !== undefined) {
    throw new PiSessionFileUnavailableError(deletedPiSessionFileMessage(file))
  }
}

const sessionsWarnedForLostTranscript = new Set<string>()

/**
 * No file is expected before a Session's first assistant reply: Pi writes its file lazily, so a
 * first run aborted before replying leaves none. Once the Session holds an assistant reply, a
 * missing file means the transcript is gone and the run starts over without it. Logged once per
 * Session, because every Pi operation on it would repeat the search.
 */
export function warnIfTranscriptLost(session: SessionDetail) {
  if (!session.messages.some((message) => message.role === 'assistant')) return
  const sessionId = String(session.id)
  if (sessionsWarnedForLostTranscript.has(sessionId)) return
  sessionsWarnedForLostTranscript.add(sessionId)
  logger.warn('Session Pi transcript file is missing; starting a new transcript', {
    sessionId,
    piSessionId: session.piSessionId,
    piSessionFile: session.piSessionFile,
  })
}
