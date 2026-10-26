const ELECTRON_INVOKE_PREFIX = /^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/u

/** Electron adds transport context to rejected invokes. Keep only the actionable reason. */
export function ipcErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(ELECTRON_INVOKE_PREFIX, '')
}

/**
 * The message a failed IPC call shows the user: the main process's reason without Electron's
 * transport prefix, or `fallback` when the failure carries no message (#356).
 */
export function ipcFailureMessage(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback
  return ipcErrorMessage(cause).trim() || fallback
}
