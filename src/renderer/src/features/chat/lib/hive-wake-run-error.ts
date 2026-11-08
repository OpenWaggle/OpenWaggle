const hiveWakeRunErrors = new WeakSet<Error>()

/**
 * The error a failed Hive wake shows. The Host started that Run for Worker updates, so no prompt
 * of the user's is retried: a wake that failed before its notice row was saved would otherwise
 * offer to resend the user's last message, which its earlier Run already answered (and which
 * may spawn Workers again). A new object, so the banner shows it even when the Run's error was
 * already on screen.
 */
export function hiveWakeRunError(error: Error) {
  const marked = new Error(error.message, { cause: error })
  marked.name = error.name
  if (error.stack !== undefined) marked.stack = error.stack
  hiveWakeRunErrors.add(marked)
  return marked
}

export function isHiveWakeRunError(error: Error | undefined) {
  return error !== undefined && hiveWakeRunErrors.has(error)
}
