/**
 * Simple promise-chain mutex for serializing async operations.
 * No external dependencies — just chains promises to guarantee FIFO ordering.
 */
export class AsyncMutex {
  private tail: Promise<void> = Promise.resolve()

  /**
   * Run `fn` exclusively — only one `fn` runs at a time.
   * Callers queue in FIFO order; errors propagate to the caller
   * without blocking subsequent queued operations.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const result = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    this.tail = this.tail.then(async () => {
      try {
        resolve(await fn())
      } catch (err) {
        reject(err)
      }
    })

    return result
  }
}
