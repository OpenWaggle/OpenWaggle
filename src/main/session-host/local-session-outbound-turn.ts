interface TurnWaiter {
  readonly resolve: () => void
  readonly signal: AbortSignal
  readonly abort: () => void
}

/** One holder at a time, granted in arrival order; a waiter whose signal aborts leaves the line. */
export class LocalSessionOutboundTurn {
  private held = false
  private readonly waiters: TurnWaiter[] = []

  constructor(private readonly aborted: () => Error) {}

  acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(this.aborted())
    if (!this.held) {
      this.held = true
      return Promise.resolve()
    }
    return new Promise((resolve, reject) => {
      const waiter: TurnWaiter = {
        signal,
        resolve: () => {
          signal.removeEventListener('abort', waiter.abort)
          this.held = true
          resolve()
        },
        abort: () => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          reject(this.aborted())
        },
      }
      signal.addEventListener('abort', waiter.abort, { once: true })
      this.waiters.push(waiter)
    })
  }

  release(): void {
    this.held = false
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      if (!waiter || waiter.signal.aborted) continue
      waiter.resolve()
      return
    }
  }
}

/**
 * Wakes the one waiter on the next notify. Only the holder of a `LocalSessionOutboundTurn` waits,
 * and it starts waiting in the same tick it found no room, so no notify is missed.
 */
export class LocalSessionOutboundReleaseSignal {
  private waiter: (() => void) | undefined

  constructor(private readonly aborted: () => Error) {}

  notify(): void {
    this.waiter?.()
  }

  /** Resolves on the next notify or after `timeoutMs`; rejects when `signal` aborts. */
  wait(signal: AbortSignal, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const settle = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (this.waiter === wake) this.waiter = undefined
      }
      const wake = () => {
        settle()
        resolve()
      }
      const abort = () => {
        settle()
        reject(this.aborted())
      }
      const timer = setTimeout(wake, timeoutMs)
      signal.addEventListener('abort', abort, { once: true })
      this.waiter = wake
    })
  }
}
