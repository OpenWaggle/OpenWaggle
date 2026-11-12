/**
 * The `piSessionFile` of an agent-kernel result: omitted while Pi has not written the Session's
 * file yet, since the port's field is optional rather than `string | undefined`.
 */
export function piSessionFileField(sessionFile: string | undefined) {
  return sessionFile === undefined ? {} : { piSessionFile: sessionFile }
}
