import { awaitWithSignal } from './await-with-signal'

interface SharedOperation {
  readonly promise: Promise<void>
  readonly controller: AbortController
  waiters: number
}

/**
 * Runs one `operation` per owner and key at a time: a caller that arrives while it runs waits for
 * that run instead of starting another. Each caller's signal stops only its own wait; the
 * operation itself is aborted once every waiting caller has aborted.
 */
export function makeSharedOperations<Owner extends object>() {
  const running = new WeakMap<Owner, Map<string, SharedOperation>>()
  return (
    owner: Owner,
    key: string,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<void>,
  ) => {
    signal?.throwIfAborted()
    const operations = running.get(owner) ?? new Map<string, SharedOperation>()
    running.set(owner, operations)
    let shared = operations.get(key)
    if (!shared) {
      const controller = new AbortController()
      const promise = Promise.resolve()
        .then(() => operation(controller.signal))
        .finally(() => operations.delete(key))
      // Every caller may have stopped waiting; the operation still settles without an unhandled rejection.
      promise.catch(() => undefined)
      shared = { promise, controller, waiters: 0 }
      operations.set(key, shared)
    }
    const current = shared
    current.waiters += 1
    const leave = () => {
      current.waiters -= 1
      if (current.waiters === 0) current.controller.abort(signal?.reason)
    }
    signal?.addEventListener('abort', leave, { once: true })
    return awaitWithSignal(current.promise, signal).finally(() =>
      signal?.removeEventListener('abort', leave),
    )
  }
}
