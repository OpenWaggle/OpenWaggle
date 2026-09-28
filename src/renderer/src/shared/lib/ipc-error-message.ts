const ELECTRON_INVOKE_PREFIX = /^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/u

/** Electron adds transport context to rejected invokes. Keep only the actionable reason. */
export function ipcErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(ELECTRON_INVOKE_PREFIX, '')
}
