/**
 * What a Session says when its Pi file cannot be used. Every message starts with
 * {@link PI_SESSION_FILE_PROBLEM}, which the error classifier shows as it is.
 */
export const PI_SESSION_FILE_PROBLEM = "This Session's Pi session file "

/** A Pi file whose folder is missing, renamed away or on a drive that is not connected. */
export function unavailablePiSessionFileMessage(piSessionFile: string) {
  return `${PI_SESSION_FILE_PROBLEM}is unavailable (${piSessionFile}): its folder is missing. Reconnect or restore it to continue the Session.`
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
