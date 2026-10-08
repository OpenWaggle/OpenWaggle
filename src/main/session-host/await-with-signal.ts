/** Settles with `operation`, or rejects with the signal's reason as soon as it aborts. */
export function awaitWithSignal<T>(operation: Promise<T>, signal?: AbortSignal) {
  if (!signal) return operation
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const abort = () => {
      if (settled) return
      settled = true
      reject(signal.reason)
    }
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      settle()
    }
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}
