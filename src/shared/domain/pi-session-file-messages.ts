/**
 * What a Session says when its Pi file cannot be used. Every message starts with
 * {@link PI_SESSION_FILE_PROBLEM}, which the error classifier shows as it is.
 */
export const PI_SESSION_FILE_PROBLEM = "This Session's Pi session file "

/**
 * Why a Pi file is out of reach: `folder`, its folder is missing, renamed away or on a drive that
 * is not connected; `file`, it may not be read, or it is a link to a file that is missing.
 */
export type PiSessionFileUnavailability = 'folder' | 'file'

/** A Pi file that is out of reach, which a Session continues from once it is back. */
export function unavailablePiSessionFileMessage(
  piSessionFile: string,
  unavailability: PiSessionFileUnavailability = 'folder',
) {
  const why =
    unavailability === 'folder'
      ? 'its folder is missing'
      : 'it cannot be read, or it links to a file that is missing'
  return `${PI_SESSION_FILE_PROBLEM}is unavailable (${piSessionFile}): ${why}. Reconnect or restore it to continue the Session.`
}

/**
 * A created Session's Pi file that was deleted while its folder is there, for what needs the file:
 * its next message starts a new transcript, as its notice says, which can then be forked or
 * compacted.
 */
export function deletedCreatedPiSessionFileMessage(piSessionFile: string, action?: string) {
  const then = action ? ` before ${action} it` : ''
  return `${PI_SESSION_FILE_PROBLEM}was deleted (${piSessionFile}). Send a message to start a new transcript${then}.`
}

/** A discovered Session's Pi file that was deleted while its folder is there. */
export function deletedPiSessionFileMessage(piSessionFile: string) {
  return `${PI_SESSION_FILE_PROBLEM}was deleted outside OpenWaggle (${piSessionFile}), so its history is gone and it cannot be continued.`
}
